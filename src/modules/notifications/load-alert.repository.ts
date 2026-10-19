import { DataSource, In, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { RequisitionEntity } from '../loads/entities/requisition.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../driver/entities/driver.entity';
import { UPCOMING_LOAD_STATUSES } from '../loads/utils/loads.types';
import { NotificationEntity } from './notifications.entity';
import { DEFAULT_REPORTING_TIME_IST, INDIA_TIME_ZONE } from './notifications.constants';
import {
  LoadAlertSnapshot,
  LoadPersonRef,
  NextPlannedTrip,
  RequisitionAlertSummary,
} from './notifications.interface';

/** Numeric coordinates, or both null when either is missing. */
function coordinatesOf(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): { originLat: number | null; originLng: number | null } {
  const latitude = lat == null ? NaN : Number(lat);
  const longitude = lng == null ? NaN : Number(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { originLat: latitude, originLng: longitude }
    : { originLat: null, originLng: null };
}

function destinationCoordinatesOf(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): { destinationLat: number | null; destinationLng: number | null } {
  const { originLat, originLng } = coordinatesOf(lat, lng);
  return { destinationLat: originLat, destinationLng: originLng };
}

function routeOf(originCity: string | null, destinationCity: string | null): string | null {
  return originCity && destinationCity ? `${originCity} to ${destinationCity}` : null;
}

/** The load (aliased `load`) reached "At plant" through tracking's geofence — LoadService's
 *  advanceFromTracking records that step with `source: 'tracking'`; a manual tap has none. */
const ARRIVED_BY_TRACKING_SQL = `EXISTS (
  SELECT 1 FROM loads.load_activities activity
  WHERE activity.tenant_id = load.tenant_id
    AND activity.load_id = load.id
    AND activity.action = 'STATUS_CHANGED'
    AND activity.to_value = 'at_plant'
    AND activity.metadata->>'source' = 'tracking'
)`;

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

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.users = dataSource.getRepository(UserEntity);
    this.drivers = dataSource.getRepository(DriverEntity);
    this.notifications = dataSource.getRepository(NotificationEntity);
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
      ewayBillNumber: load.ewayBillNumber,
      ewayBillGeneratedAt: load.ewayBillGeneratedAt,
      podStatus: load.podStatus,
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

  /** LS_N_0021 — loads still "assigned" whose reporting time is after `from` and on or before
   *  `to`. The reporting time is the posting's pickup time, else the requisition's pickup date at
   *  DEFAULT_REPORTING_TIME_IST — the same rule as reportingAtOf (utils/trip-time.ts). */
  async findAssignedLoadsDueBetween(
    from: Date,
    to: Date,
  ): Promise<{ loadId: string; tenantId: string; reportingAt: Date }[]> {
    const reportingAt =
      'COALESCE(posting.pickup_at, ' +
      '(requisition.pickup_date + CAST(:defaultReportingTime AS time)) AT TIME ZONE :timeZone)';
    const rows: { loadId: string; tenantId: string; reportingAt: Date | string }[] =
      await this.loads
        .createQueryBuilder('load')
        .leftJoin('load.requisition', 'requisition')
        .leftJoin(LoadPostingEntity, 'posting', 'posting.id = load.posting_id')
        .select('load.id', 'loadId')
        .addSelect('load.tenant_id', 'tenantId')
        .addSelect(reportingAt, 'reportingAt')
        .where('load.status = :status', { status: 'assigned' })
        .andWhere(`${reportingAt} > :from`, { from })
        .andWhere(`${reportingAt} <= :to`, { to })
        .setParameters({
          defaultReportingTime: DEFAULT_REPORTING_TIME_IST,
          timeZone: INDIA_TIME_ZONE,
        })
        .getRawMany();
    return rows.map((row) => ({ ...row, reportingAt: new Date(row.reportingAt) }));
  }

  /** LS_N_0023 — loads whose vehicle is still at the loading point, there since `before` or
   *  earlier: "At plant", or "Loading confirmed" when tracking's geofence saw it arrive (so its
   *  gate exit — which moves the load to "In transit" — is what ends detention). A load whose
   *  arrival was tapped by hand has no exit to wait for, so its detention ends at loading
   *  confirmed. */
  async findLoadsAtOriginSince(
    before: Date,
  ): Promise<{ loadId: string; tenantId: string; atPlantAt: Date }[]> {
    const rows: { loadId: string; tenantId: string; atPlantAt: Date | string }[] = await this.loads
      .createQueryBuilder('load')
      .select('load.id', 'loadId')
      .addSelect('load.tenant_id', 'tenantId')
      .addSelect('load.at_plant_at', 'atPlantAt')
      .where('load.at_plant_at <= :before', { before })
      .andWhere(
        `(load.status = 'at_plant' OR (load.status = 'loading_confirmed' AND ${ARRIVED_BY_TRACKING_SQL}))`,
      )
      .getRawMany();
    return rows.map((row) => ({ ...row, atPlantAt: new Date(row.atPlantAt) }));
  }

  /** LS_N_0023 — whether tracking's geofence (not a manual tap) moved this load to "At plant". */
  async arrivedByTracking(tenantId: string, loadId: string): Promise<boolean> {
    return this.loads
      .createQueryBuilder('load')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere('load.id = :loadId', { loadId })
      .andWhere(ARRIVED_BY_TRACKING_SQL)
      .getExists();
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
