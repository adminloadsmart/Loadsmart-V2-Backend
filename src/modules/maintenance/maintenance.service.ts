import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { toIstDateString } from '../../shared/utils/ist-time';
import { resolveDateRange } from '../../shared/utils/date-filter';
import { paginate } from '../../shared/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { MaintenanceJobEntity } from './entities/maintenance-job.entity';
import { MaintenanceJobRepository } from './repositories/maintenance-job.repository';
import { MaintenanceFleetRepository } from './repositories/fleet.repository';
import { FleetGateway } from './gateways/fleet.gateway';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { computeServiceDue } from './calculations/service-due';
import {
  DEFAULT_OVERVIEW_FILTER,
  DEFAULT_SERVICE_INTERVAL_KM,
  DEFAULT_SERVICE_INTERVAL_MONTHS,
} from './maintenance.constants';
import { MaintenanceJobType, OWN_FLEET_OWNERSHIP_TYPES } from './maintenance.types';
import {
  CloseBreakdownInput,
  CompleteServiceInput,
  ListJobsInput,
  LogServiceInput,
  OpenBreakdownInput,
  PeriodInput,
  SetServicePolicyInput,
  UpdateJobInput,
} from './maintenance.interface';
import { resolveJobCosts, toBreakdownView, toJobView } from './maintenance.views';
import { isUniqueViolation } from './utils/unique-violation';

/**
 * Services, breakdowns, service-due and job history. A workshop visit — a service check-in or a
 * breakdown — is where maintenance touches dispatch: opening one takes the truck out of dispatch
 * and closing it puts the truck back, each in the same transaction as the job write
 * (FleetGateway → VehicleService). A truck has at most one open visit at a time.
 */
export class MaintenanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobRepository: MaintenanceJobRepository,
    private readonly fleetRepository: MaintenanceFleetRepository,
    private readonly fleetGateway: FleetGateway,
    private readonly auditService: AuditService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /* ---------------------------------------------------------------- service due */

  /**
   * Trucks past their service policy right now — current state, never filtered by the period
   * control (a truck last serviced outside the window is still over policy).
   */
  async listServiceDue(tenantId: string) {
    try {
      const today = toIstDateString(new Date());
      const [vehicles, openJobs] = await Promise.all([
        this.fleetRepository.listOwnFleet(tenantId),
        this.jobRepository.listOpenJobs(tenantId),
      ]);
      const inWorkshop = new Map(openJobs.map((job) => [job.vehicleId, job]));

      const items = vehicles
        .map((vehicle) => {
          const usage = vehicle.serviceUsage;
          const intervalKm = usage?.serviceIntervalKm ?? DEFAULT_SERVICE_INTERVAL_KM;
          const intervalMonths = usage?.serviceIntervalMonths ?? DEFAULT_SERVICE_INTERVAL_MONTHS;
          const due = computeServiceDue({
            odometerKm: usage?.odometerKm ?? null,
            lastServiceDate: usage?.lastServiceDate ?? null,
            lastServiceOdometerKm: usage?.lastServiceOdometerKm ?? null,
            intervalKm,
            intervalMonths,
            today,
          });
          return { vehicle, usage, intervalKm, intervalMonths, due };
        })
        .filter((row) => row.due.isDue)
        .sort((a, b) => b.due.overdueRatio - a.due.overdueRatio)
        .map(({ vehicle, usage, intervalKm, intervalMonths, due }) => ({
          vehicle: {
            id: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            status: vehicle.status,
          },
          trigger: due.trigger,
          overdueKm: due.overdueKm,
          overdueDays: due.overdueDays,
          dueAtKm: due.dueAtKm,
          dueOn: due.dueOn,
          odometerKm: usage?.odometerKm ?? null,
          lastServiceDate: usage?.lastServiceDate ?? null,
          lastServiceOdometerKm: usage?.lastServiceOdometerKm ?? null,
          policy: {
            intervalKm,
            intervalMonths,
            isDefault: usage?.serviceIntervalKm == null || usage?.serviceIntervalMonths == null,
          },
          // Already checked in — the row stays until the service is completed (so the headline
          // still matches the queue), but the screen shows "in workshop since …" instead of a
          // "log service" action.
          inWorkshop: workshopVisit(inWorkshop.get(vehicle.id)),
        }));

      return { items, total: items.length };
    } catch (error) {
      rethrow(error, 'Failed to list service due');
    }
  }

  async setServicePolicy(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: SetServicePolicyInput,
  ) {
    try {
      await this.assertOwnFleetVehicle(tenantId, vehicleId);
      await this.fleetGateway.updateServiceUsage(tenantId, actorId, vehicleId, input);

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'MAINTENANCE_SERVICE_POLICY_SET',
        resourceType: 'vehicle',
        newData: { id: vehicleId, ...input },
      });

      return { vehicleId, ...input };
    } catch (error) {
      rethrow(error, 'Failed to set service policy');
    }
  }

  /**
   * A scheduled service, two ways:
   *  - no `completedAt` → checks the truck in: an `open` service job, and the truck leaves
   *    dispatch in the same transaction (a truck in the workshop is unavailable, whatever it is
   *    in for). POST /services/:jobId/complete checks it out.
   *  - `completedAt` given → records a service that already happened, in one call. The truck is
   *    not in the workshop now, so dispatch is untouched; the service clock still moves.
   */
  async logService(
    tenantId: string,
    actorId: string,
    input: LogServiceInput,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, input.vehicleId);
      const now = new Date();
      const completedAt = input.completedAt ? new Date(input.completedAt) : null;
      const startedAt = input.startedAt ? new Date(input.startedAt) : (completedAt ?? now);

      if (startedAt > now) throw new ValidationError('startedAt cannot be in the future');
      if (completedAt && completedAt > now) {
        throw new ValidationError('completedAt cannot be in the future');
      }
      if (completedAt && startedAt > completedAt) {
        throw new ValidationError('startedAt must be on or before completedAt');
      }

      const job = await this.dataSource.transaction(async (manager) => {
        if (!completedAt) await this.assertNotInWorkshop(vehicle, manager);

        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actorId),
            jobType: 'service',
            status: completedAt ? 'closed' : 'open',
            openedAt: startedAt,
            closedAt: completedAt,
            odometerKm: input.odometerKm,
            workshopName: input.workshopName ?? null,
            description: input.description ?? null,
            ...resolveJobCosts(input),
          },
          manager,
        );

        if (completedAt) {
          await this.applyServiceToClock(
            tenantId,
            actorId,
            vehicle.id,
            completedAt,
            input.odometerKm,
            manager,
          );
        } else {
          await this.raiseOdometer(tenantId, actorId, vehicle.id, input.odometerKm, manager);
          await this.fleetGateway.placeMaintenanceHold(
            tenantId,
            actorId,
            vehicle.id,
            `Service ${created.id}`,
            manager,
          );
        }

        await this.auditService.log(
          {
            tenantId,
            userId: actorId,
            action: completedAt ? 'MAINTENANCE_SERVICE_LOGGED' : 'MAINTENANCE_SERVICE_OPENED',
            resourceType: 'maintenance_job',
            newData: { id: created.id, vehicleId: vehicle.id, startedAt, completedAt },
          },
          manager,
        );

        return this.jobRepository.findById(tenantId, created.id, manager);
      });

      return toJobView(job!, canSeeCosts);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This vehicle is already in the workshop');
      }
      rethrow(error, 'Failed to log service');
    }
  }

  /**
   * Checks a serviced truck out of the workshop: the job closes, the service clock moves (so the
   * truck leaves the service-due queue — acceptance criterion 2) and the truck returns to
   * dispatch, all in one transaction.
   */
  async completeService(
    tenantId: string,
    actorId: string,
    jobId: string,
    input: CompleteServiceInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, 'service');
      if (job.status !== 'open') throw new ConflictError('Service is already completed');

      const completedAt = this.resolveClosedAt(job, input.completedAt);

      const closed = await this.dataSource.transaction(async (manager) => {
        await this.jobRepository.update(
          tenantId,
          jobId,
          {
            status: 'closed',
            closedAt: completedAt,
            odometerKm: input.odometerKm,
            ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...resolveJobCosts(input, job),
            updatedBy: actorId,
          },
          manager,
        );

        await this.applyServiceToClock(
          tenantId,
          actorId,
          job.vehicleId,
          completedAt,
          input.odometerKm,
          manager,
        );
        await this.fleetGateway.releaseMaintenanceHold(
          tenantId,
          actorId,
          job.vehicleId,
          `Service ${jobId} completed`,
          manager,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actorId,
            action: 'MAINTENANCE_SERVICE_COMPLETED',
            resourceType: 'maintenance_job',
            oldData: { id: jobId, status: 'open' },
            newData: { id: jobId, status: 'closed', completedAt },
          },
          manager,
        );

        return this.jobRepository.findById(tenantId, jobId, manager);
      });

      return toJobView(closed!, canSeeCosts);
    } catch (error) {
      rethrow(error, 'Failed to complete service');
    }
  }

  /* ----------------------------------------------------------------- breakdowns */

  /** Trucks off the road with a breakdown right now, oldest first — current state, not the period. */
  async listOpenBreakdowns(tenantId: string, canSeeCosts: boolean) {
    try {
      const jobs = await this.jobRepository.listOpenJobs(tenantId, 'breakdown');
      const covering = await this.fleetRepository.countOpenMarketLoadsCovering(
        tenantId,
        jobs.map((job) => job.vehicleId),
      );
      const now = new Date();
      const items = jobs.map((job) =>
        toBreakdownView(job, canSeeCosts, covering.get(job.vehicleId) ?? 0, now),
      );
      return {
        items,
        total: items.length,
        marketLoadsCovering: items.reduce((sum, item) => sum + item.marketLoadsCovering, 0),
      };
    } catch (error) {
      rethrow(error, 'Failed to list breakdowns');
    }
  }

  /**
   * Every truck in the workshop right now, split by why — the consequence line under the
   * headlines, and what the market loads are covering.
   */
  async getWorkshopSnapshot(tenantId: string) {
    try {
      const jobs = await this.jobRepository.listOpenJobs(tenantId);
      const covering = await this.fleetRepository.countOpenMarketLoadsCovering(
        tenantId,
        jobs.map((job) => job.vehicleId),
      );
      return {
        trucksOffRoadNow: jobs.length,
        brokenDown: jobs.filter((job) => job.jobType === 'breakdown').length,
        inForService: jobs.filter((job) => job.jobType === 'service').length,
        marketLoadsCovering: [...covering.values()].reduce((sum, count) => sum + count, 0),
      };
    } catch (error) {
      rethrow(error, 'Failed to read workshop snapshot');
    }
  }

  /**
   * Sends a truck to the workshop. The job insert and the vehicle's move out of dispatch
   * (status → under_maintenance) happen in one transaction — nobody has to do a second thing
   * (acceptance criterion 1).
   */
  async openBreakdown(
    tenantId: string,
    actorId: string,
    input: OpenBreakdownInput,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, input.vehicleId);
      const openedAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      if (openedAt > new Date()) {
        throw new ValidationError('occurredAt cannot be in the future');
      }

      const job = await this.dataSource.transaction(async (manager) => {
        await this.assertNotInWorkshop(vehicle, manager);

        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actorId),
            jobType: 'breakdown',
            status: 'open',
            openedAt,
            odometerKm: input.odometerKm ?? null,
            workshopName: input.workshopName ?? null,
            locationLabel: input.locationLabel ?? null,
            latitude: input.latitude === undefined ? null : String(input.latitude),
            longitude: input.longitude === undefined ? null : String(input.longitude),
            towed: input.towed ?? false,
            description: input.description ?? null,
            ...resolveJobCosts(input),
            sourceIssueReportId: input.sourceIssueReportId ?? null,
          },
          manager,
        );

        if (input.odometerKm !== undefined) {
          await this.raiseOdometer(tenantId, actorId, vehicle.id, input.odometerKm, manager);
        }
        await this.fleetGateway.placeMaintenanceHold(
          tenantId,
          actorId,
          vehicle.id,
          `Breakdown ${created.id}`,
          manager,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actorId,
            action: 'MAINTENANCE_BREAKDOWN_OPENED',
            resourceType: 'maintenance_job',
            newData: { id: created.id, vehicleId: vehicle.id, openedAt },
          },
          manager,
        );

        return this.jobRepository.findById(tenantId, created.id, manager);
      });

      return toJobView(job!, canSeeCosts);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This vehicle is already in the workshop');
      }
      rethrow(error, 'Failed to open breakdown');
    }
  }

  /**
   * Workshop, description and costs (and, on a breakdown, location and towing) can be filled in
   * while the truck is in or after. `jobType` is the route's type — PATCH /services/:id can't
   * edit a breakdown and vice versa.
   */
  async updateJob(
    tenantId: string,
    actorId: string,
    jobId: string,
    jobType: MaintenanceJobType,
    input: UpdateJobInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, jobType);

      const updated = await this.jobRepository.update(tenantId, jobId, {
        ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
        ...(input.latitude !== undefined ? { latitude: String(input.latitude) } : {}),
        ...(input.longitude !== undefined ? { longitude: String(input.longitude) } : {}),
        ...(input.towed !== undefined ? { towed: input.towed } : {}),
        ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...resolveJobCosts(input, job),
        updatedBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action:
          jobType === 'breakdown' ? 'MAINTENANCE_BREAKDOWN_UPDATED' : 'MAINTENANCE_SERVICE_UPDATED',
        resourceType: 'maintenance_job',
        newData: { id: jobId, ...input },
      });

      return toJobView(updated!, canSeeCosts);
    } catch (error) {
      rethrow(error, `Failed to update ${jobType}`);
    }
  }

  /**
   * Puts the truck back in service: the job closes and the vehicle returns to dispatch
   * (status → active) in the same transaction (acceptance criterion 1). With
   * `serviceCompleted`, the due service was also done on this visit — the service clock moves in
   * the same transaction, so there is no second job and the workshop days are counted once.
   */
  async closeBreakdown(
    tenantId: string,
    actorId: string,
    jobId: string,
    input: CloseBreakdownInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, 'breakdown');
      if (job.status !== 'open') throw new ConflictError('Breakdown is already closed');

      const closedAt = this.resolveClosedAt(job, input.closedAt);
      const serviceCompleted = input.serviceCompleted === true;
      if (serviceCompleted && input.odometerKm === undefined) {
        throw new ValidationError('odometerKm is required when serviceCompleted is true');
      }

      const closed = await this.dataSource.transaction(async (manager) => {
        await this.jobRepository.update(
          tenantId,
          jobId,
          {
            status: 'closed',
            closedAt,
            includesService: serviceCompleted,
            ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...resolveJobCosts(input, job),
            updatedBy: actorId,
          },
          manager,
        );

        if (serviceCompleted) {
          await this.applyServiceToClock(
            tenantId,
            actorId,
            job.vehicleId,
            closedAt,
            input.odometerKm!,
            manager,
          );
        } else if (input.odometerKm !== undefined) {
          await this.raiseOdometer(tenantId, actorId, job.vehicleId, input.odometerKm, manager);
        }

        await this.fleetGateway.releaseMaintenanceHold(
          tenantId,
          actorId,
          job.vehicleId,
          `Breakdown ${jobId} closed`,
          manager,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actorId,
            action: 'MAINTENANCE_BREAKDOWN_CLOSED',
            resourceType: 'maintenance_job',
            oldData: { id: jobId, status: 'open' },
            newData: { id: jobId, status: 'closed', closedAt, includesService: serviceCompleted },
          },
          manager,
        );

        return this.jobRepository.findById(tenantId, jobId, manager);
      });

      return toJobView(closed!, canSeeCosts);
    } catch (error) {
      rethrow(error, 'Failed to close breakdown');
    }
  }

  /* ---------------------------------------------------------------- job history */

  async listJobs(tenantId: string, input: ListJobsInput, canSeeCosts: boolean) {
    try {
      const range = this.resolvePeriod(input);
      const [jobs, total] = await this.jobRepository.list(tenantId, {
        range,
        vehicleId: input.vehicleId,
        jobType: input.jobType,
        page: input.page,
        limit: input.limit,
      });
      const now = new Date();
      return {
        period: { from: range.from, to: range.to },
        ...paginate(
          jobs.map((job) => toJobView(job, canSeeCosts, now)),
          total,
          input,
        ),
      };
    } catch (error) {
      rethrow(error, 'Failed to list maintenance jobs');
    }
  }

  /* -------------------------------------------------------------------- helpers */

  resolvePeriod(input: PeriodInput) {
    const range = resolveDateRange(input.filter ?? DEFAULT_OVERVIEW_FILTER, input.from, input.to);
    if (!range) throw new ValidationError('from and to are required when filter is custom');
    return range;
  }

  /**
   * Only owned/leased trucks have a workshop record with us — an attached truck is operated for
   * the shipper by somebody else, so every write refuses it (acceptance criterion 5).
   */
  async assertOwnFleetVehicle(tenantId: string, vehicleId: string): Promise<VehicleEntity> {
    const vehicle = await this.fleetRepository.findVehicle(tenantId, vehicleId);
    if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
    if (!(OWN_FLEET_OWNERSHIP_TYPES as readonly string[]).includes(vehicle.ownershipType)) {
      throw new ConflictError(
        `${vehicle.registrationNumber} is an attached vehicle — its workshop is its operator's, not tracked here`,
      );
    }
    if (vehicle.status !== 'active' && vehicle.status !== 'under_maintenance') {
      throw new ConflictError(`${vehicle.registrationNumber} is ${vehicle.status}`);
    }
    return vehicle;
  }

  /** One open workshop job per truck — whatever it is in for, it can't be checked in twice. */
  private async assertNotInWorkshop(vehicle: VehicleEntity, manager: EntityManager) {
    const open = await this.jobRepository.findOpenJob(vehicle.tenantId, vehicle.id, manager);
    if (open) {
      throw new ConflictError(
        `${vehicle.registrationNumber} is already in the workshop (${open.jobType} ${open.id})`,
      );
    }
  }

  private async assertJob(
    tenantId: string,
    jobId: string,
    jobType: MaintenanceJobType,
  ): Promise<MaintenanceJobEntity> {
    const job = await this.jobRepository.findById(tenantId, jobId);
    if (!job || job.jobType !== jobType) {
      throw new NotFoundError(
        `${jobType === 'breakdown' ? 'Breakdown' : 'Service'} ${jobId} not found`,
      );
    }
    return job;
  }

  private resolveClosedAt(job: MaintenanceJobEntity, value: string | undefined): Date {
    const closedAt = value ? new Date(value) : new Date();
    if (closedAt < job.openedAt) {
      throw new ValidationError('The close time must be on or after when the job was opened');
    }
    if (closedAt > new Date()) throw new ValidationError('The close time cannot be in the future');
    return closedAt;
  }

  /**
   * Moves the service clock — last service date/odometer — which is what takes a truck out of the
   * service-due queue. Only ever forward: a back-dated service older than the recorded last one
   * is kept as history but doesn't wind the clock back.
   */
  private async applyServiceToClock(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    serviceAt: Date,
    odometerKm: number,
    manager: EntityManager,
  ) {
    const vehicle = await this.fleetRepository.findVehicle(tenantId, vehicleId, manager);
    const usage = vehicle?.serviceUsage;
    const serviceDate = toIstDateString(serviceAt);
    const isLatest = !usage?.lastServiceDate || serviceDate >= usage.lastServiceDate;
    const odometer = Math.max(usage?.odometerKm ?? 0, odometerKm);

    await this.fleetGateway.updateServiceUsage(
      tenantId,
      actorId,
      vehicleId,
      isLatest
        ? { lastServiceDate: serviceDate, lastServiceOdometerKm: odometerKm, odometerKm: odometer }
        : { odometerKm: odometer },
      manager,
    );
  }

  /** The vehicle's odometer only moves forward — a workshop reading lower than it is ignored. */
  private async raiseOdometer(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    odometerKm: number,
    manager: EntityManager,
  ) {
    const vehicle = await this.fleetRepository.findVehicle(tenantId, vehicleId, manager);
    if (odometerKm > (vehicle?.serviceUsage?.odometerKm ?? 0)) {
      await this.fleetGateway.updateServiceUsage(
        tenantId,
        actorId,
        vehicleId,
        { odometerKm },
        manager,
      );
    }
  }
}

function workshopVisit(job: MaintenanceJobEntity | undefined) {
  return job ? { jobId: job.id, jobType: job.jobType, since: job.openedAt } : null;
}

/** Column defaults shared by every job insert — callers spread their own fields over it. */
function blankJob(tenantId: string, vehicleId: string, actorId: string) {
  return {
    tenantId,
    vehicleId,
    closedAt: null,
    odometerKm: null,
    workshopName: null,
    locationLabel: null,
    latitude: null,
    longitude: null,
    towed: false,
    description: null,
    includesService: false,
    partsReplaced: [],
    labourCost: null,
    partsCost: null,
    totalCost: null,
    sourceIssueReportId: null,
    createdBy: actorId,
  };
}
