import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { startOfIstDate, toIstDateString } from '../../shared/utils/ist-time';
import { resolveDateRange } from '../../shared/utils/date-filter';
import { paginate } from '../../shared/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.types';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { MaintenanceJobEntity } from './entities/maintenance-job.entity';
import { MaintenanceJobRepository } from './repositories/maintenance-job.repository';
import { MaintenanceFleetRepository } from './repositories/fleet.repository';
import { FleetGateway } from './gateways/fleet.gateway';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { StorageGateway } from './gateways/storage.gateway';
import { computeServiceDue } from './calculations/service-due';
import { expiredDocuments, ExpiredDocument } from './calculations/papers';
import { jobDays } from './calculations/downtime';
import {
  DEFAULT_OVERVIEW_FILTER,
  DEFAULT_SERVICE_INTERVAL_KM,
  DEFAULT_SERVICE_INTERVAL_MONTHS,
} from './maintenance.constants';
import {
  DispatchEffect,
  MaintenanceJobType,
  OWN_FLEET_OWNERSHIP_TYPES,
  SERVICE_CLOCK_TYPES,
  ServiceType,
  WorkshopStatus,
} from './maintenance.types';
import {
  Actor,
  CheckInServiceInput,
  CloseBreakdownInput,
  CompleteServiceInput,
  JobCostInput,
  ListJobsInput,
  LogServiceInput,
  OpenBreakdownInput,
  PeriodInput,
  ReleaseFromWorkshopInput,
  SetServicePolicyInput,
  UpdateJobInput,
} from './maintenance.interface';
import { resolveJobCosts, toBreakdownView, toJobView, toVehicleSummary } from './maintenance.views';
import { isUniqueViolation } from './utils/unique-violation';

/** How a finished visit treats the service clock: a ServiceType moves it only if it is one of
 *  SERVICE_CLOCK_TYPES; `null` means no service was done (a release). */
type VisitOutcome = { serviceType: ServiceType | null };

/**
 * Services, breakdowns, the workshop, service-due and job history. A workshop visit — a service
 * check-in or a breakdown — is where maintenance touches dispatch: opening one takes the truck out
 * of dispatch and finishing it (Log a service, complete, close, release) puts the truck back, each
 * in the same transaction as the job write (FleetGateway → VehicleService). A truck has at most
 * one open visit at a time.
 */
export class MaintenanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobRepository: MaintenanceJobRepository,
    private readonly fleetRepository: MaintenanceFleetRepository,
    private readonly fleetGateway: FleetGateway,
    private readonly storageGateway: StorageGateway,
    private readonly auditService: AuditService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /* ------------------------------------------------------------------ fleet state */

  /**
   * Every running own-fleet truck with the two things that decide where it stands with
   * dispatch: an open workshop visit, and expired papers. Shared by the availability bar and
   * every queue's "Effect on dispatch", so they can't disagree.
   */
  async loadFleetState(tenantId: string) {
    const [vehicles, openJobs] = await Promise.all([
      this.fleetRepository.listOwnFleet(tenantId),
      this.jobRepository.listOpenJobs(tenantId),
    ]);
    const openJobByVehicle = new Map(openJobs.map((job) => [job.vehicleId, job]));
    const expiredByVehicle = new Map<string, ExpiredDocument[]>(
      vehicles.map((vehicle) => [vehicle.id, expiredDocuments(vehicle.documents)]),
    );

    const dispatchEffect = (vehicleId: string): DispatchEffect =>
      openJobByVehicle.has(vehicleId)
        ? 'in_workshop'
        : (expiredByVehicle.get(vehicleId)?.length ?? 0) > 0
          ? 'warns_on_assign'
          : 'dispatchable';

    return { vehicles, openJobs, openJobByVehicle, expiredByVehicle, dispatchEffect };
  }

  /**
   * The fleet availability bar — every running truck in exactly one bucket, in this order: in the
   * workshop, else blocked on papers, else ready for a load.
   */
  async getFleetAvailability(tenantId: string) {
    try {
      const state = await this.loadFleetState(tenantId);
      const effects = state.vehicles.map((vehicle) => state.dispatchEffect(vehicle.id));
      return {
        total: state.vehicles.length,
        ready: effects.filter((effect) => effect === 'dispatchable').length,
        inWorkshop: effects.filter((effect) => effect === 'in_workshop').length,
        blockedOnPapers: effects.filter((effect) => effect === 'warns_on_assign').length,
      };
    } catch (error) {
      rethrow(error, 'Failed to read fleet availability');
    }
  }

  /* ---------------------------------------------------------------- service due */

  /**
   * Trucks past their service policy right now — current state, never filtered by the period
   * control (a truck last serviced outside the window is still over policy).
   */
  async listServiceDue(tenantId: string) {
    try {
      const today = toIstDateString(new Date());
      const state = await this.loadFleetState(tenantId);

      const items = state.vehicles
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
          vehicle: toVehicleSummary(vehicle),
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
          // Service due alone never blocks dispatch — only being in the workshop does.
          dispatchEffect: state.dispatchEffect(vehicle.id),
          // Already in — the row stays until the service is logged (so the headline still
          // matches the queue), but the screen shows "in workshop since …".
          inWorkshop: workshopVisit(state.openJobByVehicle.get(vehicle.id)),
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

  /* ---------------------------------------------------------------------- services */

  /**
   * Log a service — a finished service, dated the day it is logged (or `serviceDate`).
   *  - Truck not in the workshop: a closed service job; dispatch untouched.
   *  - Truck in the workshop (checked in for service, or broken down): logging finishes that
   *    visit — the job closes with these details and the truck returns to dispatch, in one
   *    transaction. A breakdown closed this way is marked includesService.
   * Only SERVICE_CLOCK_TYPES (preventive service, oil change) move the service clock.
   */
  async logService(tenantId: string, actor: Actor, input: LogServiceInput, canSeeCosts: boolean) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, input.vehicleId);
      await this.assertInvoice(tenantId, actor, input);
      const loggedAt = this.resolveDate(input.serviceDate, 'serviceDate');

      const job = await this.dataSource.transaction(async (manager) => {
        const open = await this.jobRepository.findOpenJob(tenantId, vehicle.id, manager);

        if (open) {
          if (loggedAt < open.openedAt) {
            throw new ValidationError(
              `serviceDate is before ${vehicle.registrationNumber} went into the workshop`,
            );
          }
          await this.finishVisit(
            manager,
            tenantId,
            actor.id,
            open,
            { serviceType: input.serviceType },
            {
              closedAt: loggedAt,
              odometerKm: input.odometerKm,
              workshopName: input.workshopName,
              description: input.description,
              invoiceFileKey: input.invoiceFileKey,
              costs: input,
            },
            'MAINTENANCE_SERVICE_LOGGED',
          );
          return this.jobRepository.findById(tenantId, open.id, manager);
        }

        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actor.id),
            jobType: 'service',
            status: 'closed',
            serviceType: input.serviceType,
            openedAt: loggedAt,
            closedAt: loggedAt,
            odometerKm: input.odometerKm,
            workshopName: input.workshopName ?? null,
            description: input.description ?? null,
            invoiceFileKey: input.invoiceFileKey ?? null,
            ...resolveJobCosts(input),
          },
          manager,
        );
        await this.applyVisitToVehicle(
          manager,
          tenantId,
          actor.id,
          vehicle.id,
          { serviceType: input.serviceType },
          loggedAt,
          input.odometerKm,
        );
        await this.auditService.log(
          {
            tenantId,
            userId: actor.id,
            action: 'MAINTENANCE_SERVICE_LOGGED',
            resourceType: 'maintenance_job',
            newData: {
              id: created.id,
              vehicleId: vehicle.id,
              serviceType: input.serviceType,
              loggedAt,
            },
          },
          manager,
        );
        return this.jobRepository.findById(tenantId, created.id, manager);
      });

      return toJobView(job!, canSeeCosts);
    } catch (error) {
      rethrow(error, 'Failed to log service');
    }
  }

  /**
   * Send a truck to the workshop for a service: an open service job, and the truck leaves
   * dispatch in the same transaction. Finished by Log a service or POST /services/:id/complete,
   * or undone by POST /workshop/:id/release.
   */
  async checkInService(
    tenantId: string,
    actorId: string,
    input: CheckInServiceInput,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, input.vehicleId);
      const now = new Date();
      const startedAt = input.startedAt ? new Date(input.startedAt) : now;
      if (startedAt > now) throw new ValidationError('startedAt cannot be in the future');

      const job = await this.dataSource.transaction(async (manager) => {
        await this.assertNotInWorkshop(vehicle, manager);

        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actorId),
            jobType: 'service',
            status: 'open',
            serviceType: input.serviceType ?? null,
            openedAt: startedAt,
            odometerKm: input.odometerKm ?? null,
            workshopName: input.workshopName ?? null,
            description: input.description ?? null,
          },
          manager,
        );

        if (input.odometerKm !== undefined) {
          await this.raiseOdometer(manager, tenantId, actorId, vehicle.id, input.odometerKm);
        }
        await this.fleetGateway.placeMaintenanceHold(
          tenantId,
          actorId,
          vehicle.id,
          `Service ${created.id}`,
          manager,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actorId,
            action: 'MAINTENANCE_SERVICE_OPENED',
            resourceType: 'maintenance_job',
            newData: { id: created.id, vehicleId: vehicle.id, startedAt },
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
      rethrow(error, 'Failed to check in for service');
    }
  }

  /** Finishes a checked-in service visit by id — the same outcome as Log a service on that truck. */
  async completeService(
    tenantId: string,
    actor: Actor,
    jobId: string,
    input: CompleteServiceInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, 'service');
      if (job.status !== 'open') throw new ConflictError('Service is already completed');
      await this.assertInvoice(tenantId, actor, input);
      const completedAt = this.resolveClosedAt(job, input.completedAt);

      const closed = await this.dataSource.transaction(async (manager) => {
        await this.finishVisit(
          manager,
          tenantId,
          actor.id,
          job,
          { serviceType: input.serviceType ?? job.serviceType ?? 'preventive_service' },
          {
            closedAt: completedAt,
            odometerKm: input.odometerKm,
            workshopName: input.workshopName,
            description: input.description,
            invoiceFileKey: input.invoiceFileKey,
            costs: input,
          },
          'MAINTENANCE_SERVICE_COMPLETED',
        );
        return this.jobRepository.findById(tenantId, jobId, manager);
      });

      return toJobView(closed!, canSeeCosts);
    } catch (error) {
      rethrow(error, 'Failed to complete service');
    }
  }

  /* ---------------------------------------------------------------------- workshop */

  /** Every truck in the workshop right now — service check-ins and breakdowns together. */
  async listInWorkshop(tenantId: string, canSeeCosts: boolean) {
    try {
      const jobs = await this.jobRepository.listOpenJobs(tenantId);
      const covering = await this.fleetRepository.countOpenMarketLoadsCovering(
        tenantId,
        jobs.map((job) => job.vehicleId),
      );
      const now = new Date();
      const items = jobs.map((job) => ({
        ...toBreakdownView(job, canSeeCosts, covering.get(job.vehicleId) ?? 0, now),
        dispatchEffect: 'in_workshop' as DispatchEffect,
      }));
      return {
        items,
        total: items.length,
        brokenDown: items.filter((item) => item.jobType === 'breakdown').length,
        inForService: items.filter((item) => item.jobType === 'service').length,
      };
    } catch (error) {
      rethrow(error, 'Failed to list trucks in the workshop');
    }
  }

  /**
   * Trucks with expired papers that aren't in the workshop — the "Blocked on papers" bucket and
   * tab (same exclusive rule as the availability bar). Dispatch only warns on these today.
   */
  async listBlockedOnPapers(tenantId: string) {
    try {
      const today = toIstDateString(new Date());
      const state = await this.loadFleetState(tenantId);
      const items = state.vehicles
        .filter((vehicle) => state.dispatchEffect(vehicle.id) === 'warns_on_assign')
        .map((vehicle) => {
          const expired = state.expiredByVehicle.get(vehicle.id) ?? [];
          return {
            vehicle: toVehicleSummary(vehicle),
            expiredDocuments: expired.map((document) => ({
              ...document,
              daysExpired: Math.max(
                0,
                Math.round(
                  (startOfIstDate(today).getTime() -
                    startOfIstDate(document.expiryDate).getTime()) /
                    86_400_000,
                ),
              ),
            })),
            dispatchEffect: 'warns_on_assign' as DispatchEffect,
          };
        })
        .sort((a, b) =>
          a.expiredDocuments[0].expiryDate.localeCompare(b.expiredDocuments[0].expiryDate),
        );
      return { items, total: items.length };
    } catch (error) {
      rethrow(error, 'Failed to list trucks blocked on papers');
    }
  }

  /**
   * Release from the workshop — finishes an open visit without a service: the service clock is
   * untouched and the truck returns to dispatch.
   */
  async releaseFromWorkshop(
    tenantId: string,
    actorId: string,
    jobId: string,
    input: ReleaseFromWorkshopInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.jobRepository.findById(tenantId, jobId);
      if (!job) throw new NotFoundError(`Workshop visit ${jobId} not found`);
      if (job.status !== 'open') throw new ConflictError('This visit is already closed');
      const closedAt = this.resolveClosedAt(job, input.closedAt);

      const released = await this.dataSource.transaction(async (manager) => {
        await this.finishVisit(
          manager,
          tenantId,
          actorId,
          job,
          { serviceType: null },
          { closedAt, odometerKm: input.odometerKm, description: input.description },
          'MAINTENANCE_WORKSHOP_RELEASED',
        );
        return this.jobRepository.findById(tenantId, jobId, manager);
      });

      return toJobView(released!, canSeeCosts);
    } catch (error) {
      rethrow(error, 'Failed to release from the workshop');
    }
  }

  /**
   * The plain in/out toggle — just the vehicle and where it should be:
   *  - in_workshop: opens a bare workshop visit (a service job with no details yet) and takes the
   *    truck out of dispatch; if it is already in, returns that visit unchanged.
   *  - available: releases whatever visit is open (service or breakdown) without a service, and
   *    the truck returns to dispatch; if it isn't in, nothing changes.
   * Both are idempotent. Details can follow — Log a service finishes the visit with them.
   */
  async setWorkshopStatus(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    status: WorkshopStatus,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, vehicleId);
      const open = await this.jobRepository.findOpenJob(tenantId, vehicle.id);

      if (status === 'available') {
        const visit = open
          ? await this.releaseFromWorkshop(tenantId, actorId, open.id, {}, canSeeCosts)
          : null;
        return { vehicleId: vehicle.id, status, visit };
      }

      if (open) {
        const current = await this.jobRepository.findById(tenantId, open.id);
        return { vehicleId: vehicle.id, status, visit: toJobView(current!, canSeeCosts) };
      }

      try {
        const visit = await this.checkInService(
          tenantId,
          actorId,
          { vehicleId: vehicle.id },
          canSeeCosts,
        );
        return { vehicleId: vehicle.id, status, visit };
      } catch (error) {
        // Lost a race with another check-in — the truck is in, which is what was asked for.
        const raced = await this.jobRepository.findOpenJob(tenantId, vehicle.id);
        if (!raced) throw error;
        const current = await this.jobRepository.findById(tenantId, raced.id);
        return { vehicleId: vehicle.id, status, visit: toJobView(current!, canSeeCosts) };
      }
    } catch (error) {
      rethrow(error, 'Failed to update workshop status');
    }
  }

  /** The consequence line — trucks in the workshop now, and market loads bought to cover them. */
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
      const items = jobs.map((job) => ({
        ...toBreakdownView(job, canSeeCosts, covering.get(job.vehicleId) ?? 0, now),
        dispatchEffect: 'in_workshop' as DispatchEffect,
      }));
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
   * Sends a broken-down truck to the workshop. The job insert and the vehicle's move out of
   * dispatch (status → under_maintenance) happen in one transaction — nobody has to do a second
   * thing (acceptance criterion 1).
   */
  async openBreakdown(
    tenantId: string,
    actor: Actor,
    input: OpenBreakdownInput,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.assertOwnFleetVehicle(tenantId, input.vehicleId);
      await this.assertInvoice(tenantId, actor, input);
      const openedAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      if (openedAt > new Date()) {
        throw new ValidationError('occurredAt cannot be in the future');
      }

      const job = await this.dataSource.transaction(async (manager) => {
        await this.assertNotInWorkshop(vehicle, manager);

        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actor.id),
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
            invoiceFileKey: input.invoiceFileKey ?? null,
            ...resolveJobCosts(input),
            sourceIssueReportId: input.sourceIssueReportId ?? null,
          },
          manager,
        );

        if (input.odometerKm !== undefined) {
          await this.raiseOdometer(manager, tenantId, actor.id, vehicle.id, input.odometerKm);
        }
        await this.fleetGateway.placeMaintenanceHold(
          tenantId,
          actor.id,
          vehicle.id,
          `Breakdown ${created.id}`,
          manager,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actor.id,
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
   * Workshop, description, costs and invoice (and, on a breakdown, location and towing) can be
   * filled in while the truck is in or after. `jobType` is the route's type — PATCH /services/:id
   * can't edit a breakdown and vice versa.
   */
  async updateJob(
    tenantId: string,
    actor: Actor,
    jobId: string,
    jobType: MaintenanceJobType,
    input: UpdateJobInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, jobType);
      await this.assertInvoice(tenantId, actor, input);

      const updated = await this.jobRepository.update(tenantId, jobId, {
        ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
        ...(input.latitude !== undefined ? { latitude: String(input.latitude) } : {}),
        ...(input.longitude !== undefined ? { longitude: String(input.longitude) } : {}),
        ...(input.towed !== undefined ? { towed: input.towed } : {}),
        ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.invoiceFileKey !== undefined ? { invoiceFileKey: input.invoiceFileKey } : {}),
        ...resolveJobCosts(input, job),
        updatedBy: actor.id,
      });

      await this.auditService.log({
        tenantId,
        userId: actor.id,
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
   * Puts a broken-down truck back in service: the job closes and the vehicle returns to dispatch
   * (status → active) in the same transaction (acceptance criterion 1). With `serviceCompleted`,
   * the due service was also done on this visit — the service clock moves in the same
   * transaction, so there is no second job and the workshop days are counted once.
   */
  async closeBreakdown(
    tenantId: string,
    actor: Actor,
    jobId: string,
    input: CloseBreakdownInput,
    canSeeCosts: boolean,
  ) {
    try {
      const job = await this.assertJob(tenantId, jobId, 'breakdown');
      if (job.status !== 'open') throw new ConflictError('Breakdown is already closed');
      await this.assertInvoice(tenantId, actor, input);

      const closedAt = this.resolveClosedAt(job, input.closedAt);
      if (input.serviceCompleted && input.odometerKm === undefined) {
        throw new ValidationError('odometerKm is required when serviceCompleted is true');
      }

      const closed = await this.dataSource.transaction(async (manager) => {
        await this.finishVisit(
          manager,
          tenantId,
          actor.id,
          job,
          { serviceType: input.serviceCompleted ? 'preventive_service' : null },
          {
            closedAt,
            odometerKm: input.odometerKm,
            description: input.description,
            invoiceFileKey: input.invoiceFileKey,
            costs: input,
          },
          'MAINTENANCE_BREAKDOWN_CLOSED',
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

  /** An attached invoice must be a confirmed `maintenance/invoice` upload of this tenant. */
  async assertInvoice(tenantId: string, actor: Actor, input: { invoiceFileKey?: string }) {
    if (input.invoiceFileKey) {
      await this.storageGateway.assertInvoiceUpload(tenantId, actor.role, input.invoiceFileKey);
    }
  }

  /**
   * A calendar date from the modal → the instant the job is stamped with: now when it is today
   * (or omitted), else the start of that IST day. Never in the future.
   */
  resolveDate(date: string | undefined, field: string): Date {
    const now = new Date();
    if (!date || date === toIstDateString(now)) return now;
    if (date > toIstDateString(now)) throw new ValidationError(`${field} cannot be in the future`);
    return startOfIstDate(date);
  }

  /** The vehicle's odometer only moves forward — a workshop reading lower than it is ignored. */
  async raiseOdometer(
    manager: EntityManager,
    tenantId: string,
    actorId: string,
    vehicleId: string,
    odometerKm: number,
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

  /**
   * Closes an open workshop visit — the one code path behind Log a service (on a truck that is
   * in), complete, close breakdown and release — and returns the truck to dispatch in the same
   * transaction.
   */
  private async finishVisit(
    manager: EntityManager,
    tenantId: string,
    actorId: string,
    job: MaintenanceJobEntity,
    outcome: VisitOutcome,
    details: {
      closedAt: Date;
      odometerKm?: number;
      workshopName?: string;
      description?: string;
      invoiceFileKey?: string;
      costs?: JobCostInput;
    },
    action: AuditAction,
  ) {
    const serviced = outcome.serviceType !== null;
    // Logging a service against a breakdown adds its bill to the breakdown's, rather than
    // overwriting what the repair already cost.
    const costs =
      job.jobType === 'breakdown' && serviced && details.costs?.cost !== undefined
        ? { ...details.costs, cost: Number(job.totalCost ?? 0) + details.costs.cost }
        : (details.costs ?? {});

    await this.jobRepository.update(
      tenantId,
      job.id,
      {
        status: 'closed',
        closedAt: details.closedAt,
        ...(serviced ? { serviceType: outcome.serviceType } : {}),
        ...(serviced && job.jobType === 'breakdown' ? { includesService: true } : {}),
        ...(details.odometerKm !== undefined ? { odometerKm: details.odometerKm } : {}),
        ...(details.workshopName !== undefined ? { workshopName: details.workshopName } : {}),
        ...(details.description !== undefined ? { description: details.description } : {}),
        ...(details.invoiceFileKey !== undefined ? { invoiceFileKey: details.invoiceFileKey } : {}),
        ...resolveJobCosts(costs, job),
        updatedBy: actorId,
      },
      manager,
    );

    await this.applyVisitToVehicle(
      manager,
      tenantId,
      actorId,
      job.vehicleId,
      outcome,
      details.closedAt,
      details.odometerKm,
    );
    await this.fleetGateway.releaseMaintenanceHold(
      tenantId,
      actorId,
      job.vehicleId,
      `${job.jobType === 'breakdown' ? 'Breakdown' : 'Service'} ${job.id} closed`,
      manager,
    );

    await this.auditService.log(
      {
        tenantId,
        userId: actorId,
        action,
        resourceType: 'maintenance_job',
        oldData: { id: job.id, status: 'open' },
        newData: {
          id: job.id,
          status: 'closed',
          closedAt: details.closedAt,
          serviceType: outcome.serviceType,
        },
      },
      manager,
    );
  }

  /**
   * What a finished visit does to the vehicle record: a clock-type service moves the service
   * clock (last service date/odometer — what takes a truck out of the service-due queue), and
   * any odometer reading raises the odometer. The clock only moves forward: a back-dated service
   * older than the recorded last one is kept as history but doesn't wind it back.
   */
  private async applyVisitToVehicle(
    manager: EntityManager,
    tenantId: string,
    actorId: string,
    vehicleId: string,
    outcome: VisitOutcome,
    at: Date,
    odometerKm: number | undefined,
  ) {
    const movesClock =
      outcome.serviceType !== null &&
      SERVICE_CLOCK_TYPES.includes(outcome.serviceType) &&
      odometerKm !== undefined;

    if (!movesClock) {
      if (odometerKm !== undefined) {
        await this.raiseOdometer(manager, tenantId, actorId, vehicleId, odometerKm);
      }
      return;
    }

    const vehicle = await this.fleetRepository.findVehicle(tenantId, vehicleId, manager);
    const usage = vehicle?.serviceUsage;
    const serviceDate = toIstDateString(at);
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

  /** One open workshop visit per truck — whatever it is in for, it can't be checked in twice. */
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
}

function workshopVisit(job: MaintenanceJobEntity | undefined) {
  return job
    ? {
        jobId: job.id,
        jobType: job.jobType,
        since: job.openedAt,
        days: jobDays(job.openedAt, null, new Date()),
      }
    : null;
}

/** Column defaults shared by every job insert — callers spread their own fields over it. */
export function blankJob(tenantId: string, vehicleId: string, actorId: string) {
  return {
    tenantId,
    vehicleId,
    serviceType: null,
    closedAt: null,
    odometerKm: null,
    workshopName: null,
    locationLabel: null,
    latitude: null,
    longitude: null,
    towed: false,
    description: null,
    includesService: false,
    invoiceFileKey: null,
    partsReplaced: [],
    labourCost: null,
    partsCost: null,
    totalCost: null,
    sourceIssueReportId: null,
    createdBy: actorId,
  };
}
