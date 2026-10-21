import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { UPCOMING_LOAD_STATUSES } from '../loads/utils/loads.types';
import { LoadAlertSnapshot, NextPlannedTrip } from './notifications.interface';

function routeOf(originCity: string | null, destinationCity: string | null): string | null {
  return originCity && destinationCity ? `${originCity} to ${destinationCity}` : null;
}

/**
 * Read side of the loads data the load-event notifications need (load-alerts.ts) and the
 * "cannot be dispatched" card's first affected trip (vehicle-document-alerts.ts) — reads
 * LoadEntity and its relations directly, same as maintenance's fleet.repository.ts. Read-only.
 */
export class LoadAlertRepository {
  private readonly loads: Repository<LoadEntity>;
  private readonly postings: Repository<LoadPostingEntity>;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
  }

  /** Null when the load doesn't exist in this tenant. Route/consignee come from the load itself,
   *  falling back to the posting's typed addresses. */
  async findSnapshot(tenantId: string, loadId: string): Promise<LoadAlertSnapshot | null> {
    const load = await this.loads.findOne({
      where: { id: loadId, tenantId },
      relations: {
        vehicle: true,
        transporter: true,
        loadingPoint: true,
        customerDeliveryPoint: true,
        dropLoadingPoint: true,
        customer: true,
      },
    });
    if (!load) return null;

    const posting = load.postingId
      ? await this.postings.findOneBy({ id: load.postingId, tenantId })
      : null;
    const deliveryPoint = load.customerDeliveryPoint;

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
      route: routeOf(
        load.loadingPoint?.city ?? posting?.pickupAddress?.city ?? null,
        deliveryPoint?.city ??
          deliveryPoint?.location ??
          load.dropLoadingPoint?.city ??
          posting?.dropAddress?.city ??
          null,
      ),
      consigneeName: load.customer?.name ?? null,
    };
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
        pickupDate: MoreThanOrEqual(fromDate),
      },
      relations: {
        transporter: true,
        loadingPoint: true,
        customerDeliveryPoint: true,
        dropLoadingPoint: true,
      },
      order: { pickupDate: 'ASC', code: 'ASC' },
    });
    if (!load?.pickupDate) return null;

    const deliveryPoint = load.customerDeliveryPoint;
    return {
      loadId: load.id,
      loadCode: load.code,
      route: routeOf(
        load.loadingPoint?.city ?? null,
        deliveryPoint?.city ?? deliveryPoint?.location ?? load.dropLoadingPoint?.city ?? null,
      ),
      pickupDate: load.pickupDate,
      transporterName: load.transporter?.name ?? null,
    };
  }
}
