import {
  DataSource,
  In,
  IsNull,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { RequisitionEntity } from '../loads/entities/requisition.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../driver/entities/driver.entity';
import { DriverTenantRelationEntity } from '../driver/entities/driver-tenant-relation.entity';
import { DriverVerificationEntity } from '../driver/entities/driver-verification.entity';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { ProductEntity } from '../masters/product/entities/product.entity';
import { LoadIssueReportEntity } from '../loads/entities/load-issue-report.entity';
import { LoadActivityEntity } from '../loads/entities/load-activity.entity';
import {
  DELIVERED_LOAD_STATUSES,
  LoadStatus,
  PodStatus,
  UPCOMING_LOAD_STATUSES,
} from '../loads/utils/loads.types';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { NotificationEntity } from './notifications.entity';
import {
  CLAIMABLE_SHORTAGE_OR_DAMAGE_STATUSES,
  DEFAULT_CLAIM_WINDOW_DAYS,
  DEFAULT_REPORTING_TIME_IST,
  INDIA_TIME_ZONE,
  TRIP_FINISHED_LOAD_STATUSES,
} from './notifications.constants';
import {
  DetentionCandidate,
  AssignedLoadDue,
  DestinationCoordinates,
  DetentionTerms,
  LicenceCheckRow,
  LoadAlertSnapshot,
  LoadPersonRef,
  LoadRef,
  NextPlannedTrip,
  OriginCoordinates,
  PodPendingLoad,
  RawAssignedLoadDueRow,
  RawDetentionRow,
  RawPodPendingRow,
  RequisitionAlertSummary,
  TrackedArrival,
} from './notifications.interface';

/** Numeric coordinates, or both null when either is missing. */
function coordinatesOf(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): OriginCoordinates {
  const latitude = lat == null ? NaN : Number(lat);
  const longitude = lng == null ? NaN : Number(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { originLat: latitude, originLng: longitude }
    : { originLat: null, originLng: null };
}

function destinationCoordinatesOf(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): DestinationCoordinates {
  const { originLat, originLng } = coordinatesOf(lat, lng);
  return { destinationLat: originLat, destinationLng: originLng };
}

function routeOf(originCity: string | null, destinationCity: string | null): string | null {
  return originCity && destinationCity ? `${originCity} to ${destinationCity}` : null;
}

/** The same arrival under the status names before the 13-stage lifecycle — the
 *  LoadLifecycleStages migration renames loads.status but not the activity history, so a trip
 *  that was under way then still carries these. */
const PRE_LIFECYCLE_ARRIVAL: Record<TrackedArrival, string> = {
  reached_loading: 'at_plant',
  reached_unloading: 'reached_delivery_point',
};

/** Only if the organization row is missing — the real defaults are the columns' (migration
 *  AddDetentionTermsAndDropDeparture). */
const DEFAULT_DETENTION_TERMS: DetentionTerms = {
  loadingFreeHours: 4,
  unloadingFreeHours: 4,
  ratePerHour: 500,
};

const detentionCandidateOf = (row: RawDetentionRow): DetentionCandidate => ({
  loadId: row.loadId,
  tenantId: row.tenantId,
  arrivedAt: new Date(row.arrivedAt),
  freeHours: Number(row.freeHours),
});

/**
 * Read side of the loads data the load-event notifications need (load-alerts.ts) and the
 * "cannot be dispatched" card's first affected trip (vehicle-document-alerts.ts) — reads
 * LoadEntity and its relations directly, same as maintenance's fleet.repository.ts. Read-only.
 */
export class LoadAlertRepository {
  private readonly loads: Repository<LoadEntity>;
  private readonly postings: Repository<LoadPostingEntity>;
  private readonly customers: Repository<CustomerEntity>;
  private readonly requisitions: Repository<RequisitionEntity>;
  private readonly users: Repository<UserEntity>;
  private readonly drivers: Repository<DriverEntity>;
  private readonly notifications: Repository<NotificationEntity>;
  private readonly organizations: Repository<OrganizationEntity>;
  private readonly issueReports: Repository<LoadIssueReportEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;
  private readonly verifications: Repository<DriverVerificationEntity>;
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly products: Repository<ProductEntity>;

  constructor(dataSource: DataSource) {
    this.organizations = dataSource.getRepository(OrganizationEntity);
    this.issueReports = dataSource.getRepository(LoadIssueReportEntity);
    this.loads = dataSource.getRepository(LoadEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.users = dataSource.getRepository(UserEntity);
    this.drivers = dataSource.getRepository(DriverEntity);
    this.notifications = dataSource.getRepository(NotificationEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
    this.verifications = dataSource.getRepository(DriverVerificationEntity);
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.products = dataSource.getRepository(ProductEntity);
  }

  /** Null when the load doesn't exist in this tenant. Route/consignee come from the requisition
   *  (Dispatch Planning) or, for a Post-a-load load, from its posting. */
  async findSnapshot(tenantId: string, loadId: string): Promise<LoadAlertSnapshot | null> {
    const load = await this.loads.findOne({
      where: { id: loadId, tenantId },
      relations: {
        vehicle: true,
        driver: true,
        transporter: true,
        cargoItems: true,
        requisition: { loadingPoint: true, customerDeliveryPoint: true, customer: true },
      },
    });
    if (!load) return null;

    const posting = load.postingId
      ? await this.postings.findOneBy({ id: load.postingId, tenantId })
      : null;
    const postingCustomer =
      !load.requisition && posting?.customerId
        ? await this.customers.findOneBy({ id: posting.customerId, tenantId })
        : null;
    const deliveryPoint = load.requisition?.customerDeliveryPoint ?? null;
    const originCity = load.requisition?.loadingPoint?.city ?? posting?.pickupAddress?.city ?? null;
    const destinationCity =
      deliveryPoint?.city ?? deliveryPoint?.location ?? posting?.dropAddress?.city ?? null;
    const cargoTonnes = load.cargoItems?.length
      ? load.cargoItems.reduce((sum, item) => sum + Number(item.tonnesPerTruck), 0).toFixed(2)
      : load.plannedCapacityTonnes;

    return {
      code: load.code,
      status: load.status,
      sourceType: load.sourceType,
      vehicleNumber: load.vehicleNumber ?? load.vehicle?.registrationNumber ?? null,
      transporterName: load.transporter?.name ?? null,
      transporterBankAccountNumber: load.transporter?.bankAccountNumber ?? null,
      transporterBankIfsc: load.transporter?.bankIfsc ?? null,
      freightType: load.freightType,
      freightValue: load.freightValue,
      plannedCapacityTonnes: load.plannedCapacityTonnes,
      advancePercentage: load.advancePercentage,
      advancePaidAt: load.advancePaidAt,
      balancePaidAt: load.balancePaidAt,
      ewayBillNumber: load.ewayBillNumber,
      ewayBillGeneratedAt: load.ewayBillGeneratedAt,
      podStatus: load.podStatus,
      podReviewedAt: load.podReviewedAt,
      podReviewedBy: load.podReviewedBy,
      podRejectionReason: load.podRejectionReason,
      podReceiverName: load.podReceiverName,
      podQuantityReceived: load.podQuantityReceived,
      numberOfTonnesShort: load.numberOfTonnesShort,
      shortageOrDamage: load.shortageOrDamage,
      route: routeOf(originCity, destinationCity),
      consigneeName: load.requisition?.customer?.name ?? postingCustomer?.name ?? null,
      driverName: load.driverName ?? load.driver?.fullName ?? null,
      driverPhone: load.driverNumber ?? load.driver?.phoneNumber ?? null,
      createdBy: load.createdBy,
      originCity,
      destinationCity,
      elrNumber: load.elrNumber,
      hasLorryReceipt: Boolean(load.elrFileKey),
      documentCount:
        [
          load.invoiceFileKey,
          load.ewayBillFileKey,
          load.elrFileKey,
          load.weighingSlipFileKey,
        ].filter(Boolean).length + (load.loadingPhotoFileKeys?.length ?? 0),
      cargoTonnes,
      ...coordinatesOf(
        load.requisition?.loadingPoint?.latitude ?? posting?.pickupAddress?.latitude,
        load.requisition?.loadingPoint?.longitude ?? posting?.pickupAddress?.longitude,
      ),
      originGeofenceRadiusM: load.requisition?.loadingPoint?.geofenceRadiusM ?? null,
      originLoadingPointId:
        load.requisition?.loadingPointId ?? posting?.pickupLoadingPointId ?? null,
      destinationDeliveryPointId:
        load.requisition?.customerDeliveryPointId ?? posting?.dropCustomerDeliveryPointId ?? null,
      destinationLoadingPointId: posting?.dropLoadingPointId ?? null,
      ...destinationCoordinatesOf(
        deliveryPoint?.latitude ?? posting?.dropAddress?.latitude,
        deliveryPoint?.longitude ?? posting?.dropAddress?.longitude,
      ),
      destinationGeofenceRadiusM: deliveryPoint?.geofenceRadiusM ?? null,
      atPlantAt: load.atPlantAt,
      pickupDate: load.requisition?.pickupDate ?? null,
      pickupAt: posting?.pickupAt ?? null,
      reachedDeliveryPointAt: load.reachedDeliveryPointAt,
      deliveredAt: load.deliveredAt,
      departedDropAt: load.departedDropAt,
      promisedDeliveryDate: load.requisition?.expectedDeliveryDate ?? null,
      customerFreeHoursAtDrop:
        load.requisition?.customer?.freeHoursAtDrop ?? postingCustomer?.freeHoursAtDrop ?? null,
      postingDeliverByAt: posting?.deliverByAt ?? null,
      cargoValuePerTonne:
        load.requisition?.cargoValuePerTonne ?? posting?.cargoValuePerTonne ?? null,
    };
  }

  /** LS_N_0054/0037 — a driver's issue report; null when it doesn't exist in this tenant. The
   *  load it's on comes from findSnapshot. */
  async findIssueReport(tenantId: string, issueId: string): Promise<LoadIssueReportEntity | null> {
    return this.issueReports.findOneBy({ id: issueId, tenantId });
  }

  /** LS_N_0034 — the company's days to raise a shortage/damage claim (default 7 in the DB). */
  async findClaimWindowDays(tenantId: string): Promise<number> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
      select: { claimWindowDays: true },
    });
    return organization?.claimWindowDays ?? DEFAULT_CLAIM_WINDOW_DAYS;
  }

  /** LS_N_0050 — what the licence check needs about the load's driver, vehicle and cargo. The
   *  driver is the load's own (or, for a typed-in market driver, the one in this organisation
   *  with that phone number); the vehicle its own (or the one with that plate). Each part is
   *  null when it isn't in the masters. Null when the load doesn't exist. */
  async findLicenceCheck(tenantId: string, loadId: string): Promise<LicenceCheckRow | null> {
    const load = await this.loads.findOne({
      where: { id: loadId, tenantId },
      relations: { driver: true, vehicle: true, cargoItems: true, posting: true },
    });
    if (!load) return null;

    const driver = load.driverId
      ? load.driver?.deletedAt
        ? null
        : load.driver
      : await this.findDriverByPhone(tenantId, load.driverNumber);
    const vehicle = load.vehicleId
      ? load.vehicle?.tenantId === tenantId && !load.vehicle.deletedAt
        ? load.vehicle
        : null
      : await this.findVehicleByPlate(tenantId, load.vehicleNumber);
    const latestVerification = driver
      ? await this.verifications.findOne({
          where: { driverId: driver.id, licenseClass: Not(IsNull()), deletedAt: IsNull() },
          select: { licenseClass: true },
          order: { createdAt: 'DESC' },
        })
      : null;
    const productIds = [
      ...(load.cargoItems ?? []).map((item) => item.productId),
      ...(load.posting?.commodityId ? [load.posting.commodityId] : []),
    ];
    const hazardousProducts = productIds.length
      ? await this.products.find({
          where: { id: In(productIds), classification: 'hazardous' },
          select: { productDetails: true },
        })
      : [];

    return {
      driverId: driver?.id ?? null,
      driverName: driver?.fullName ?? load.driverName,
      endorsements: driver?.licenseEndorsements ?? [],
      licenceClass: latestVerification?.licenseClass ?? null,
      vehicleNo: load.vehicleNumber ?? vehicle?.registrationNumber ?? null,
      grossVehicleWeightKg: vehicle?.grossVehicleWeightKg ?? null,
      hazardousProducts: [...new Set(hazardousProducts.map((product) => product.productDetails))],
    };
  }

  /** A typed-in market driver in this organisation, matched on the last 10 digits of the phone
   *  number (same rule as AssignmentComplianceService). */
  private async findDriverByPhone(
    tenantId: string,
    driverNumber: string | null,
  ): Promise<DriverEntity | null> {
    const phoneDigits = driverNumber?.replace(/\D+/g, '').slice(-10) || null;
    if (!phoneDigits) return null;
    const relation = await this.driverRelations
      .createQueryBuilder('relation')
      .innerJoinAndSelect('relation.driver', 'driver')
      .where('relation.tenant_id = :tenantId', { tenantId })
      .andWhere('relation.deleted_at IS NULL')
      .andWhere("relation.status <> 'rejected'")
      .andWhere('driver.deleted_at IS NULL')
      .andWhere("right(regexp_replace(driver.phone_number, '\\D', '', 'g'), 10) = :phone", {
        phone: phoneDigits,
      })
      .getOne();
    return relation?.driver ?? null;
  }

  /** A typed-in market vehicle in this organisation, matched on its plate without spaces/dashes
   *  and case-blind (same rule as AssignmentComplianceService). */
  private async findVehicleByPlate(
    tenantId: string,
    vehicleNumber: string | null,
  ): Promise<VehicleEntity | null> {
    const plate = vehicleNumber?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!plate) return null;
    return this.vehicles
      .createQueryBuilder('vehicle')
      .where('vehicle.tenant_id = :tenantId', { tenantId })
      .andWhere('vehicle.deleted_at IS NULL')
      .andWhere(
        "upper(regexp_replace(vehicle.registration_number, '[^A-Za-z0-9]', '', 'g')) = :plate",
        { plate },
      )
      .getOne();
  }

  /** LS_N_0034 — loads whose E-POD recorded a shortage or damage and whose claim-window reminder
   *  (`daysBefore` days before the company's window closes) fell due after `from` and on or
   *  before `to`. Companies whose window is no longer than `daysBefore` get no reminder. */
  async findClaimReminderDueBetween(from: Date, to: Date, daysBefore: number): Promise<LoadRef[]> {
    const dueAt = `load.delivered_at + make_interval(days => org.claim_window_days - :daysBefore)`;
    return this.loads
      .createQueryBuilder('load')
      .innerJoin(OrganizationEntity, 'org', 'org.id = load.tenant_id')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .where('load.status IN (:...deliveredStatuses)', {
        // The E-POD is in — delivered (either stage), a money stage after it, or closed.
        deliveredStatuses: [...TRIP_FINISHED_LOAD_STATUSES],
      })
      .andWhere(
        '(load.number_of_tonnes_short > 0 OR load.shortage_or_damage IN (:...claimableStatuses))',
        { claimableStatuses: [...CLAIMABLE_SHORTAGE_OR_DAMAGE_STATUSES] },
      )
      .andWhere('org.claim_window_days > :daysBefore', { daysBefore })
      .andWhere(`${dueAt} > :from`, { from })
      .andWhere(`${dueAt} <= :to`, { to })
      .getRawMany<LoadRef>();
  }

  /** The company's detention terms — the database holds the defaults (4 h / 4 h / ₹500). */
  async findDetentionTerms(tenantId: string): Promise<DetentionTerms> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
      select: { loadingFreeHours: true, unloadingFreeHours: true, detentionRatePerHour: true },
    });
    return {
      loadingFreeHours: organization?.loadingFreeHours ?? DEFAULT_DETENTION_TERMS.loadingFreeHours,
      unloadingFreeHours:
        organization?.unloadingFreeHours ?? DEFAULT_DETENTION_TERMS.unloadingFreeHours,
      ratePerHour:
        organization?.detentionRatePerHour != null
          ? Number(organization.detentionRatePerHour)
          : DEFAULT_DETENTION_TERMS.ratePerHour,
    };
  }

  /** A staff user's or driver's name for "{{driver_name}} confirmed …" — null if not found. */
  async findPersonName(person: LoadPersonRef): Promise<string | null> {
    const found =
      'driverId' in person
        ? await this.drivers.findOne({ where: { id: person.driverId }, select: { fullName: true } })
        : await this.users.findOne({ where: { id: person.userId }, select: { fullName: true } });
    return found?.fullName ?? null;
  }

  /** Null when the requisition doesn't exist in this tenant. */
  async findRequisitionSummary(
    tenantId: string,
    requisitionId: string,
  ): Promise<RequisitionAlertSummary | null> {
    const requisition = await this.requisitions.findOne({
      where: { id: requisitionId, tenantId },
      relations: { loadingPoint: true, customerDeliveryPoint: true, customer: true },
    });
    if (!requisition) return null;
    const deliveryPoint = requisition.customerDeliveryPoint;
    return {
      code: requisition.code,
      route: routeOf(
        requisition.loadingPoint?.city ?? null,
        deliveryPoint?.city ?? deliveryPoint?.location ?? null,
      ),
      pickupDate: requisition.pickupDate,
      consigneeName: requisition.customer?.name ?? null,
    };
  }

  /** Whether a load has been planned on the requisition after `since` — LS_N_0017's "another
   *  vehicle was assigned instead" for a blocked own-fleet dispatch. */
  async hasLoadOnRequisitionSince(
    tenantId: string,
    requisitionId: string,
    since: Date,
  ): Promise<boolean> {
    return this.loads.exists({ where: { tenantId, requisitionId, createdAt: MoreThan(since) } });
  }

  /** Whether a notification of `type` whose metadata contains `metadata` went out in this tenant
   *  (after `since`, when given) — e.g. a laddered alert's step (LS_N_0021/0023) or a blocked
   *  assignment already alerted (LS_N_0017). */
  async hasSentNotification(
    tenantId: string,
    type: string,
    metadata: Record<string, string>,
    since?: Date,
  ): Promise<boolean> {
    const query = this.notifications
      .createQueryBuilder('notification')
      .where('notification.tenant_id = :tenantId', { tenantId })
      .andWhere('notification.type = :type', { type })
      .andWhere('notification.metadata @> CAST(:metadata AS jsonb)', {
        metadata: JSON.stringify(metadata),
      });
    if (since) query.andWhere('notification.created_at > :since', { since });
    return query.getExists();
  }

  /** LS_N_0021 — loads not yet at the loading point ("Truck assigned" / "In transit to loading")
   *  whose reporting time is after `from` and on or before
   *  `to`. The reporting time is the posting's pickup time, else the requisition's pickup date at
   *  DEFAULT_REPORTING_TIME_IST — the same rule as reportingAtOf (utils/trip-time.ts). */
  async findAssignedLoadsDueBetween(from: Date, to: Date): Promise<AssignedLoadDue[]> {
    const notAtPlant: LoadStatus[] = ['truck_assigned', 'in_transit_loading'];
    const reportingAt =
      'COALESCE(posting.pickup_at, ' +
      '(requisition.pickup_date + CAST(:defaultReportingTime AS time)) AT TIME ZONE :timeZone)';
    const rows = await this.loads
      .createQueryBuilder('load')
      .leftJoin('load.requisition', 'requisition')
      .leftJoin(LoadPostingEntity, 'posting', 'posting.id = load.posting_id')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .addSelect(reportingAt, 'reportingAt')
      .where('load.status IN (:...statuses)', { statuses: notAtPlant })
      .andWhere(`${reportingAt} > :from`, { from })
      .andWhere(`${reportingAt} <= :to`, { to })
      .setParameters({
        defaultReportingTime: DEFAULT_REPORTING_TIME_IST,
        timeZone: INDIA_TIME_ZONE,
      })
      .getRawMany<RawAssignedLoadDueRow>();
    return rows.map((row) => ({ ...row, reportingAt: new Date(row.reportingAt) }));
  }

  /** LS_N_0023 — loads whose vehicle is still at the loading point past the company's free
   *  hours: "Reached loading point", or "Loaded" when tracking's geofence saw it arrive (so its
   *  gate exit — which moves the load to "In transit to unloading" — is what ends detention). A load whose
   *  arrival was tapped by hand has no exit to wait for, so its detention ends at loading
   *  confirmed. */
  async findLoadingDetentionCandidates(now: Date): Promise<DetentionCandidate[]> {
    const query = this.loads
      .createQueryBuilder('load')
      .innerJoin(OrganizationEntity, 'org', 'org.id = load.tenant_id')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .addSelect('load.at_plant_at', 'arrivedAt')
      .addSelect('org.loading_free_hours', 'freeHours')
      .where('load.at_plant_at + make_interval(hours => org.loading_free_hours) <= :now', { now });
    const arrivedByTracking = this.arrivedByTrackingCondition(query, 'reached_loading');
    query.andWhere(
      `(load.status = :atLoading OR (load.status = :loaded AND ${arrivedByTracking}))`,
      { atLoading: 'reached_loading', loaded: 'loaded' },
    );
    const rows = await query.getRawMany<RawDetentionRow>();
    return rows.map(detentionCandidateOf);
  }

  /** LS_N_0032 — loads whose vehicle is still at the delivery point past its free hours (the
   *  customer's own, else the company's): "Reached unloading point" until it leaves; once the
   *  E-POD is in, only when tracking's geofence saw it arrive — then it's at the drop until
   *  tracking sees it leave (departed_drop_at), for as long as tracking follows a delivered load
   *  (`followSince`). A load whose arrival was tapped by hand ends detention at the E-POD. */
  async findUnloadingDetentionCandidates(
    now: Date,
    followSince: Date,
  ): Promise<DetentionCandidate[]> {
    const freeHours =
      'COALESCE(customer.free_hours_at_drop, posting_customer.free_hours_at_drop, org.unloading_free_hours)';
    const query = this.loads
      .createQueryBuilder('load')
      .innerJoin(OrganizationEntity, 'org', 'org.id = load.tenant_id')
      .leftJoin(RequisitionEntity, 'requisition', 'requisition.id = load.requisition_id')
      .leftJoin(CustomerEntity, 'customer', 'customer.id = requisition.customer_id')
      .leftJoin(LoadPostingEntity, 'posting', 'posting.id = load.posting_id')
      .leftJoin(CustomerEntity, 'posting_customer', 'posting_customer.id = posting.customer_id')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .addSelect('load.reached_delivery_point_at', 'arrivedAt')
      .addSelect(freeHours, 'freeHours')
      .where(`load.reached_delivery_point_at + make_interval(hours => ${freeHours}) <= :now`, {
        now,
      })
      .andWhere('load.departed_drop_at IS NULL');
    const arrivedByTracking = this.arrivedByTrackingCondition(query, 'reached_unloading');
    query.andWhere(
      `(load.status = :atUnloading OR (load.status IN (:...unloadedStatuses) AND load.delivered_at > :followSince AND ${arrivedByTracking}))`,
      {
        atUnloading: 'reached_unloading',
        followSince,
        unloadedStatuses: [...TRIP_FINISHED_LOAD_STATUSES],
      },
    );
    const rows = await query.getRawMany<RawDetentionRow>();
    return rows.map(detentionCandidateOf);
  }

  /** LS_N_0039 — loads still waiting on a POD whose wait started after `from` and on or before
   *  `to`: at the delivery point with no E-POD yet (since it got there), or delivered with the
   *  E-POD rejected and not re-uploaded (since the rejection). */
  async findPodPendingBetween(from: Date, to: Date): Promise<PodPendingLoad[]> {
    const atDrop: LoadStatus = 'reached_unloading';
    const rejected: PodStatus = 'rejected';
    const since =
      'CASE WHEN load.status = :atDrop THEN load.reached_delivery_point_at ELSE load.pod_reviewed_at END';
    const rows = await this.loads
      .createQueryBuilder('load')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .addSelect(since, 'since')
      .where(
        '(load.status = :atDrop OR (load.status IN (:...delivered) AND load.pod_status = :rejected))',
        { atDrop, delivered: [...DELIVERED_LOAD_STATUSES], rejected },
      )
      .andWhere(`${since} > :from`, { from })
      .andWhere(`${since} <= :to`, { to })
      .getRawMany<RawPodPendingRow>();
    return rows.map((row) => ({ ...row, since: new Date(row.since) }));
  }

  /** Whether tracking's geofence (not a manual tap) moved this load to `arrival`. */
  async arrivedByTracking(
    tenantId: string,
    loadId: string,
    arrival: TrackedArrival,
  ): Promise<boolean> {
    const query = this.loads
      .createQueryBuilder('load')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere('load.id = :loadId', { loadId });
    return query.andWhere(this.arrivedByTrackingCondition(query, arrival)).getExists();
  }

  /** `EXISTS (…)` on `query`'s `load` alias: tracking's geofence (not a manual tap) moved the
   *  load to `arrival` — LoadService's advanceFromTracking records that step with
   *  `source: 'tracking'`. */
  private arrivedByTrackingCondition(
    query: SelectQueryBuilder<LoadEntity>,
    arrival: TrackedArrival,
  ): string {
    const trackedStep = query
      .subQuery()
      .select('1')
      .from(LoadActivityEntity, 'activity')
      .where('activity.tenant_id = load.tenant_id')
      .andWhere('activity.load_id = load.id')
      .andWhere('activity.action = :statusChangedAction', { statusChangedAction: 'STATUS_CHANGED' })
      .andWhere('activity.to_value IN (:...arrivalStatuses)', {
        arrivalStatuses: [arrival, PRE_LIFECYCLE_ARRIVAL[arrival]],
      })
      .andWhere("activity.metadata->>'source' = :trackingSource", { trackingSource: 'tracking' })
      .getQuery();
    return `EXISTS ${trackedStep}`;
  }

  /** The earliest not-yet-started trip on a vehicle picking up on or after `fromDate`. */
  async findNextPlannedTrip(
    tenantId: string,
    vehicleId: string,
    fromDate: string,
  ): Promise<NextPlannedTrip | null> {
    const load = await this.loads.findOne({
      where: {
        tenantId,
        vehicleId,
        status: In([...UPCOMING_LOAD_STATUSES]),
        requisition: { pickupDate: MoreThanOrEqual(fromDate) },
      },
      relations: {
        transporter: true,
        requisition: { loadingPoint: true, customerDeliveryPoint: true },
      },
      order: { requisition: { pickupDate: 'ASC' }, code: 'ASC' },
    });
    if (!load?.requisition) return null;

    const deliveryPoint = load.requisition.customerDeliveryPoint;
    return {
      loadId: load.id,
      loadCode: load.code,
      route: routeOf(
        load.requisition.loadingPoint?.city ?? null,
        deliveryPoint?.city ?? deliveryPoint?.location ?? null,
      ),
      pickupDate: load.requisition.pickupDate,
      transporterName: load.transporter?.name ?? null,
    };
  }
}
