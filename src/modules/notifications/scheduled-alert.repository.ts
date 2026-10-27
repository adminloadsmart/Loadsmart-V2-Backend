import {
  Between,
  DataSource,
  FindOperator,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { DriverTenantRelationEntity } from '../driver/entities/driver-tenant-relation.entity';
import { LoadEntity } from '../loads/entities/load.entity';
import { RequisitionEntity } from '../loads/entities/requisition.entity';
import { DELIVERED_LOAD_STATUSES, UPCOMING_LOAD_STATUSES } from '../loads/utils/loads.types';
import { addDays, addMonths, daysBetween } from '../maintenance/calculations/dates';
import { MaintenanceJobEntity } from '../maintenance/entities/maintenance-job.entity';
import { TyreEntity } from '../maintenance/entities/tyre.entity';
import {
  MAINTAINED_VEHICLE_STATUSES,
  OWN_FLEET_OWNERSHIP_TYPES,
} from '../maintenance/maintenance.types';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import { ProductEntity } from '../masters/product/entities/product.entity';
import { VehicleDocumentEntity } from '../masters/vehicle/entities/vehicle-document.entity';
import { VehicleVerificationSnapshotEntity } from '../masters/vehicle/entities/vehicle-verification-snapshot.entity';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import {
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VehicleDocumentTypeWithExpiry,
  VehicleVerificationStatus,
} from '../masters/vehicle/vehicle.type';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { UserPermissionEntity } from '../roles/entities/user-permission.entity';
import { MasterKind } from './catalog/notification-catalog';
import { NotificationEntity } from './notifications.entity';
import {
  DAILY_BRIEF_POD_PENDING_STATUS,
  DAILY_BRIEF_RUNNING_STATUSES,
  MAINTENANCE_COST_AVERAGE_MONTHS,
  TRIP_FINISHED_LOAD_STATUSES,
} from './notifications.constants';
import {
  DailyBriefCounts,
  DriverUpcomingTrips,
  ExpiringDriverLicence,
  ExpiringVehicleDocument,
  FreeVehicle,
  MaintenanceCostAverages,
  MaintenanceJobCostAverageRow,
  OrganizationUserAccess,
  PlannedTripWindow,
  ServiceDueVehicle,
  TyreCost,
} from './notifications.interface';

const isTypeWithExpiry = (type: string): type is VehicleDocumentTypeWithExpiry =>
  (VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY as readonly string[]).includes(type);

function pickupDateIn(window: PlannedTripWindow): FindOperator<string> {
  if (window.toDate) return Between(window.fromDate, window.toDate);
  return window.excludeFromDate ? MoreThan(window.fromDate) : MoreThanOrEqual(window.fromDate);
}

/**
 * Read side of the scheduled (cron) notifications — the daily vehicle-document, driver-licence,
 * service and tyre checks, the digests, the master-approval counts and the back-in-service
 * resolver. Reads other modules' entities directly, same as LoadAlertRepository. Read-only.
 */
export class ScheduledAlertRepository {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly vehicleDocuments: Repository<VehicleDocumentEntity>;
  private readonly verificationSnapshots: Repository<VehicleVerificationSnapshotEntity>;
  private readonly maintenanceJobs: Repository<MaintenanceJobEntity>;
  private readonly tyres: Repository<TyreEntity>;
  private readonly loads: Repository<LoadEntity>;
  private readonly requisitions: Repository<RequisitionEntity>;
  private readonly users: Repository<UserEntity>;
  private readonly userPermissions: Repository<UserPermissionEntity>;
  private readonly organizations: Repository<OrganizationEntity>;
  private readonly notifications: Repository<NotificationEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;
  private readonly loadingPoints: Repository<LoadingPointEntity>;
  private readonly products: Repository<ProductEntity>;
  private readonly customers: Repository<CustomerEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.vehicleDocuments = dataSource.getRepository(VehicleDocumentEntity);
    this.verificationSnapshots = dataSource.getRepository(VehicleVerificationSnapshotEntity);
    this.maintenanceJobs = dataSource.getRepository(MaintenanceJobEntity);
    this.tyres = dataSource.getRepository(TyreEntity);
    this.loads = dataSource.getRepository(LoadEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.users = dataSource.getRepository(UserEntity);
    this.userPermissions = dataSource.getRepository(UserPermissionEntity);
    this.organizations = dataSource.getRepository(OrganizationEntity);
    this.notifications = dataSource.getRepository(NotificationEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
    this.products = dataSource.getRepository(ProductEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
  }

  // ── Notification history ──────────────────────────────────────────────────────────────────

  /** Whether a notification of `type` whose metadata contains `metadata` went out in this tenant
   *  (to `recipientUserId`, when given) — the "never twice for the same run" checks. */
  hasSentNotification(
    tenantId: string,
    type: string,
    metadata: Record<string, string>,
    recipientUserId?: string,
  ): Promise<boolean> {
    const query = this.sentNotificationsQuery(tenantId, type, metadata);
    if (recipientUserId) {
      query.andWhere('notification.recipient_user_id = :recipientUserId', { recipientUserId });
    }
    return query.getExists();
  }

  /** The metadata of every notification of `type` whose metadata contains `metadata` — e.g. the
   *  run dates or stages already sent for one service cycle. */
  async listSentNotificationMetadata(
    tenantId: string,
    type: string,
    metadata: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const sent = await this.sentNotificationsQuery(tenantId, type, metadata)
      .select(['notification.id', 'notification.metadata'])
      .getMany();
    return sent.map((notification) => notification.metadata ?? {});
  }

  private sentNotificationsQuery(
    tenantId: string,
    type: string,
    metadata: Record<string, string>,
  ): SelectQueryBuilder<NotificationEntity> {
    return this.notifications
      .createQueryBuilder('notification')
      .where('notification.tenant_id = :tenantId', { tenantId })
      .andWhere('notification.type = :type', { type })
      .andWhere('notification.metadata @> CAST(:metadata AS jsonb)', {
        metadata: JSON.stringify(metadata),
      });
  }

  // ── Organisations and users ───────────────────────────────────────────────────────────────

  listActiveOrganizations(): Promise<OrganizationEntity[]> {
    return this.organizations.find({
      where: { status: 'active' },
      select: { id: true, name: true, registeredBusinessName: true, companyLegalName: true },
    });
  }

  /** Active organisation users of a tenant with their effective permissions (role + direct
   *  grants), oldest first. */
  async listOrganizationUsers(tenantId: string): Promise<OrganizationUserAccess[]> {
    const users = await this.users.find({
      where: { tenantId, deletedAt: IsNull(), role: { scope: 'organization' } },
      relations: { role: { permissions: true } },
      order: { createdAt: 'ASC' },
    });
    if (users.length === 0) return [];
    const grants = await this.userPermissions.find({
      where: { userId: In(users.map((user) => user.id)) },
      relations: { permission: true },
    });
    return users.map((user) => ({
      id: user.id,
      role: user.role.name,
      permissions: [
        ...new Set([
          ...user.role.permissions.map((permission) => permission.key),
          ...grants
            .filter((grant) => grant.userId === user.id)
            .map((grant) => grant.permission.key),
        ]),
      ],
    }));
  }

  /** Records still pending approval of one master kind, matching each service's own "pending"
   *  (products use approval_status; drivers their organisation relation awaiting staff review,
   *  as driver-tenant-relation.repository.ts's pending list does). */
  countPendingMasters(tenantId: string, kind: MasterKind): Promise<number> {
    switch (kind) {
      case 'vehicle':
        return this.vehicles.count({ where: { tenantId, status: 'pending', deletedAt: IsNull() } });
      case 'driver':
        return this.driverRelations.count({
          where: { tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
        });
      case 'loading_point':
        return this.loadingPoints.count({
          where: { tenantId, status: 'pending', deletedAt: IsNull() },
        });
      case 'product':
        return this.products.count({
          where: { tenantId, approvalStatus: 'pending_approval', deletedAt: IsNull() },
        });
      case 'customer':
        return this.customers.count({
          where: { tenantId, status: 'pending', deletedAt: IsNull() },
        });
    }
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────────────────────

  vehicleExists(tenantId: string, vehicleId: string): Promise<boolean> {
    return this.vehicles.exists({ where: { id: vehicleId, tenantId, deletedAt: IsNull() } });
  }

  /** The latest recorded Vahan result for a vehicle; null when it was never checked. */
  async findLatestVahanStatus(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleVerificationStatus | null> {
    const latest = await this.verificationSnapshots.findOne({
      where: { vehicleId, tenantId },
      select: { verificationStatus: true },
      order: { checkedAt: 'DESC', createdAt: 'DESC' },
    });
    return latest?.verificationStatus ?? null;
  }

  /** LS_N_0059/0060 — own-fleet active vehicles added on/before `today` with no trip in hand;
   *  last trip = the latest delivery/close of any of its loads, else when it was added. */
  async findFreeVehicles(today: string): Promise<FreeVehicle[]> {
    const vehicles = await this.vehicles
      .createQueryBuilder('vehicle')
      .leftJoin('vehicle.telemetryMeta', 'telemetry', 'telemetry.deleted_at IS NULL')
      .leftJoin(LoadEntity, 'load', 'load.vehicle_id = vehicle.id')
      .select('vehicle.tenant_id', 'tenantId')
      .addSelect('vehicle.id', 'vehicleId')
      .addSelect('vehicle.registration_number', 'vehicleNo')
      .addSelect(
        'COALESCE(MAX(COALESCE(load.delivered_at, load.closed_at, load.updated_at)), vehicle.created_at)',
        'lastTripAt',
      )
      .addSelect('telemetry.fixed_cost_monthly', 'fixedCostMonthly')
      .addSelect('telemetry.emi_amount', 'emiAmount')
      .where('vehicle.deleted_at IS NULL')
      .andWhere('vehicle.status = :status', { status: 'active' })
      .andWhere('vehicle.ownership_type IN (:...ownershipTypes)', {
        ownershipTypes: [...OWN_FLEET_OWNERSHIP_TYPES],
      })
      .andWhere('CAST(vehicle.created_at AS date) <= CAST(:today AS date)', { today })
      .andWhere((query) => {
        const tripInHand = query
          .subQuery()
          .select('1')
          .from(LoadEntity, 'activeLoad')
          .where('activeLoad.vehicle_id = vehicle.id')
          .andWhere('activeLoad.status NOT IN (:...finishedStatuses)', {
            finishedStatuses: [...TRIP_FINISHED_LOAD_STATUSES],
          })
          .getQuery();
        return `NOT EXISTS ${tripInHand}`;
      })
      .groupBy('vehicle.id')
      .addGroupBy('telemetry.id')
      .orderBy('vehicle.registration_number')
      .getRawMany<FreeVehicle>();
    return vehicles.map((vehicle) => ({ ...vehicle, lastTripAt: new Date(vehicle.lastTripAt) }));
  }

  /** LS_N_0060 — one organisation's trips on the road, PODs pending and vehicles blocked by an
   *  expired dispatch document (on `today`). */
  async countDailyBrief(tenantId: string, today: string): Promise<DailyBriefCounts> {
    const [running, pods, blocked] = await Promise.all([
      this.loads.count({ where: { tenantId, status: In([...DAILY_BRIEF_RUNNING_STATUSES]) } }),
      this.loads.count({
        where: [
          { tenantId, status: DAILY_BRIEF_POD_PENDING_STATUS },
          { tenantId, status: In([...DELIVERED_LOAD_STATUSES]), podStatus: 'rejected' },
        ],
      }),
      this.vehicles
        .createQueryBuilder('vehicle')
        .innerJoin(
          'vehicle.documents',
          'document',
          'document.deleted_at IS NULL AND document.document_type IN (:...documentTypes) AND document.expiry_date <= :today',
          { documentTypes: [...VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY], today },
        )
        .where('vehicle.tenant_id = :tenantId', { tenantId })
        .andWhere('vehicle.deleted_at IS NULL')
        .andWhere('vehicle.status IN (:...statuses)', {
          statuses: [...MAINTAINED_VEHICLE_STATUSES],
        })
        .getCount(),
    ]);
    return { running, pods, blocked };
  }

  /** LS_N_0056/0057 — own-fleet vehicles in service with a service record to measure from, not
   *  already in the workshop (no open job). */
  async findServiceDueVehicles(): Promise<ServiceDueVehicle[]> {
    const vehicles = await this.vehicles
      .createQueryBuilder('vehicle')
      .innerJoinAndSelect('vehicle.serviceUsage', 'usage', 'usage.deleted_at IS NULL')
      .where('vehicle.deleted_at IS NULL')
      .andWhere('vehicle.ownership_type IN (:...ownershipTypes)', {
        ownershipTypes: [...OWN_FLEET_OWNERSHIP_TYPES],
      })
      .andWhere('vehicle.status IN (:...statuses)', {
        statuses: [...MAINTAINED_VEHICLE_STATUSES],
      })
      .andWhere('usage.odometer_km IS NOT NULL')
      .andWhere('usage.last_service_odometer_km IS NOT NULL')
      .andWhere((query) => {
        const openJob = query
          .subQuery()
          .select('1')
          .from(MaintenanceJobEntity, 'openJob')
          .where('openJob.vehicle_id = vehicle.id')
          .andWhere('openJob.status = :openStatus', { openStatus: 'open' })
          .getQuery();
        return `NOT EXISTS ${openJob}`;
      })
      .orderBy('vehicle.registration_number')
      .getMany();
    return vehicles.map(({ tenantId, id, registrationNumber, serviceUsage }) => ({
      tenantId,
      vehicleId: id,
      vehicleNo: registrationNumber,
      odometerKm: serviceUsage.odometerKm ?? 0,
      lastServiceOdometerKm: serviceUsage.lastServiceOdometerKm ?? 0,
      lastServiceDate: serviceUsage.lastServiceDate,
      intervalKm: serviceUsage.serviceIntervalKm,
    }));
  }

  /** Planned (not yet started) trips on a vehicle with pickup inside `window`. */
  countPlannedVehicleTrips(
    tenantId: string,
    vehicleId: string,
    window: PlannedTripWindow,
  ): Promise<number> {
    return this.loads.count({
      where: {
        tenantId,
        vehicleId,
        status: In([...UPCOMING_LOAD_STATUSES]),
        requisition: { pickupDate: pickupDateIn(window) },
      },
    });
  }

  /** LS_N_0057 — org-wide average cost of closed service and breakdown jobs over the last
   *  MAINTENANCE_COST_AVERAGE_MONTHS months. */
  async averageMaintenanceCosts(tenantId: string, today: string): Promise<MaintenanceCostAverages> {
    const averages = await this.maintenanceJobs
      .createQueryBuilder('job')
      .select('job.job_type', 'jobType')
      .addSelect('AVG(job.total_cost)', 'average')
      .where('job.tenant_id = :tenantId', { tenantId })
      .andWhere('job.status = :closedStatus', { closedStatus: 'closed' })
      .andWhere('job.total_cost IS NOT NULL')
      .andWhere('job.job_type IN (:...jobTypes)', { jobTypes: ['service', 'breakdown'] })
      .andWhere('job.closed_at >= :since', {
        since: addMonths(today, -MAINTENANCE_COST_AVERAGE_MONTHS),
      })
      .groupBy('job.job_type')
      .getRawMany<MaintenanceJobCostAverageRow>();
    const averageOf = (jobType: string) => {
      const average = averages.find((row) => row.jobType === jobType)?.average;
      return average != null ? Number(average) : null;
    };
    return { service: averageOf('service'), breakdown: averageOf('breakdown') };
  }

  /** LS_N_0055 — a closed workshop visit with its vehicle; null when it isn't closed. */
  findClosedMaintenanceJob(tenantId: string, jobId: string): Promise<MaintenanceJobEntity | null> {
    return this.maintenanceJobs.findOne({
      where: { id: jobId, tenantId, status: 'closed' },
      relations: { vehicle: true },
    });
  }

  countOpenRequisitions(tenantId: string): Promise<number> {
    return this.requisitions.count({ where: { tenantId, status: 'open' } });
  }

  // ── Vehicle documents ─────────────────────────────────────────────────────────────────────

  /** LS_N_0047 — dated vehicle documents expiring on one of `expiryDates`. */
  findVehicleDocumentsExpiringOn(
    today: string,
    expiryDates: string[],
  ): Promise<ExpiringVehicleDocument[]> {
    return this.findVehicleDocuments(
      today,
      this.vehicleDocumentsQuery().andWhere('document.expiry_date IN (:...expiryDates)', {
        expiryDates,
      }),
    );
  }

  /** LS_N_0047/0048 roll-ups — dated vehicle documents expiring from `fromDate` to `toDate`. */
  findVehicleDocumentsExpiringBetween(
    today: string,
    fromDate: string,
    toDate: string,
  ): Promise<ExpiringVehicleDocument[]> {
    return this.findVehicleDocuments(
      today,
      this.vehicleDocumentsQuery().andWhere('document.expiry_date BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      }),
    );
  }

  /** LS_N_0048 — dated vehicle documents expired on/before `today`, on the days a whole number
   *  of `repeatDays` after expiry (the expiry day itself included). */
  findVehicleDocumentsExpiredOnRepeat(
    today: string,
    repeatDays: number,
  ): Promise<ExpiringVehicleDocument[]> {
    return this.findVehicleDocuments(
      today,
      this.vehicleDocumentsQuery()
        .andWhere('document.expiry_date <= :today', { today })
        .andWhere('MOD(CAST(:today AS date) - document.expiry_date, :repeatDays) = 0', {
          repeatDays,
        }),
    );
  }

  /** Dated documents on live vehicles, soonest expiry first. */
  private vehicleDocumentsQuery(): SelectQueryBuilder<VehicleDocumentEntity> {
    return this.vehicleDocuments
      .createQueryBuilder('document')
      .innerJoinAndSelect('document.vehicle', 'vehicle', 'vehicle.deleted_at IS NULL')
      .where('document.deleted_at IS NULL')
      .andWhere('document.expiry_date IS NOT NULL')
      .andWhere('document.document_type IN (:...documentTypes)', {
        documentTypes: [...VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY],
      })
      .orderBy('document.expiry_date', 'ASC')
      .addOrderBy('document.id', 'ASC');
  }

  private async findVehicleDocuments(
    today: string,
    query: SelectQueryBuilder<VehicleDocumentEntity>,
  ): Promise<ExpiringVehicleDocument[]> {
    const documents = await query.getMany();
    return documents.flatMap(({ id, tenantId, vehicleId, vehicle, documentType, expiryDate }) =>
      expiryDate && isTypeWithExpiry(documentType)
        ? [
            {
              id,
              tenantId,
              vehicleId,
              vehicleNo: vehicle.registrationNumber,
              documentType,
              expiryDate,
              daysLeft: daysBetween(today, expiryDate),
            },
          ]
        : [],
    );
  }

  // ── Drivers ───────────────────────────────────────────────────────────────────────────────

  /** LS_N_0049 — drivers whose licence expires exactly `daysLeft` days from `today` (0 = today),
   *  one row per organisation they belong to (drivers are a global profile; membership is the
   *  tenant relation, rejected relations excluded). */
  async findDriverLicencesExpiringIn(
    today: string,
    daysLeft: number[],
  ): Promise<ExpiringDriverLicence[]> {
    const relations = await this.driverRelations.find({
      where: {
        deletedAt: IsNull(),
        status: Not('rejected'),
        driver: {
          deletedAt: IsNull(),
          licenseExpiry: In(daysLeft.map((days) => addDays(today, days))),
        },
      },
      relations: { driver: true },
    });
    return relations.flatMap(({ tenantId, driver }) =>
      driver.licenseExpiry
        ? [
            {
              driverId: driver.id,
              tenantId,
              driverName: driver.fullName,
              licenceNumber: driver.licenseNumber,
              expiryDate: driver.licenseExpiry,
              daysLeft: daysBetween(today, driver.licenseExpiry),
            },
          ]
        : [],
    );
  }

  /** Whether the driver is still in this organisation with a licence expired on/before `onDate`
   *  — a renewal (expiry moved past it) makes this false. */
  hasExpiredDriverLicence(tenantId: string, driverId: string, onDate: string): Promise<boolean> {
    return this.driverRelations.exists({
      where: {
        tenantId,
        driverId,
        deletedAt: IsNull(),
        status: Not('rejected'),
        driver: { deletedAt: IsNull(), licenseExpiry: LessThanOrEqual(onDate) },
      },
    });
  }

  /** Upcoming (not yet started) trips a driver is rostered on, picking up from `today`. */
  async countDriverUpcomingTrips(
    tenantId: string,
    driverId: string,
    today: string,
  ): Promise<DriverUpcomingTrips> {
    const upcomingStatuses = In([...UPCOMING_LOAD_STATUSES]);
    const [upcoming, pickupToday] = await Promise.all([
      this.loads.count({
        where: {
          tenantId,
          driverId,
          status: upcomingStatuses,
          requisition: { pickupDate: MoreThanOrEqual(today) },
        },
      }),
      this.loads.exists({
        where: { tenantId, driverId, status: upcomingStatuses, requisition: { pickupDate: today } },
      }),
    ]);
    return { upcoming, pickupToday };
  }

  // ── Tyres ─────────────────────────────────────────────────────────────────────────────────

  async listTenantsWithFittedTyres(): Promise<string[]> {
    const tenants = await this.tyres
      .createQueryBuilder('tyre')
      .select('tyre.tenant_id', 'tenantId')
      .distinct(true)
      .where('tyre.status = :status', { status: 'fitted' })
      .getRawMany<Pick<TyreEntity, 'tenantId'>>();
    return tenants.map((tenant) => tenant.tenantId);
  }

  /** LS_N_0058 — every tyre of a tenant (fitted or not) with its km run and its share of its
   *  Record Tyre Maintenance entry's cost. */
  async findTyreCosts(tenantId: string): Promise<TyreCost[]> {
    const tyres = await this.tyres
      .createQueryBuilder('tyre')
      .leftJoinAndSelect('tyre.maintenanceJob', 'job')
      .innerJoinAndSelect('tyre.vehicle', 'vehicle')
      .leftJoinAndSelect('vehicle.serviceUsage', 'usage', 'usage.deleted_at IS NULL')
      .where('tyre.tenant_id = :tenantId', { tenantId })
      .getMany();
    const tyresPerJob = new Map<string, number>();
    for (const { maintenanceJobId } of tyres) {
      if (maintenanceJobId) {
        tyresPerJob.set(maintenanceJobId, (tyresPerJob.get(maintenanceJobId) ?? 0) + 1);
      }
    }
    return tyres.map((tyre) => {
      const endOdometerKm = tyre.removedOdometerKm ?? tyre.vehicle.serviceUsage?.odometerKm;
      const tyresOnJob = tyre.maintenanceJobId ? tyresPerJob.get(tyre.maintenanceJobId) : 0;
      return {
        tyreId: tyre.id,
        kmRun: endOdometerKm != null ? endOdometerKm - tyre.fittedOdometerKm : null,
        cost:
          tyre.maintenanceJob?.totalCost != null && tyresOnJob
            ? Number(tyre.maintenanceJob.totalCost) / tyresOnJob
            : null,
      };
    });
  }
}
