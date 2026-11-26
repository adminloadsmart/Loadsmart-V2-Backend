import { DataSource, IsNull } from 'typeorm';
import { rethrow } from '../../shared/errors';
import { CustomerDeliveryPointGeofenceSync } from '../customers/customer-delivery-point-geofence.sync';
import { CustomerDeliveryPointEntity } from '../customers/entities/customer-delivery-point.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { LoadingPointGeofenceSync } from '../masters/loading-point/loading-point-geofence.sync';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import { AddressPinLookup, pinForAddress } from '../places/address-pin';
import { GeofenceRepository } from './geofence.repository';

/** The master points a load or trip runs between; nulls are skipped. */
export interface TripMasterPoints {
  loadingPointIds: Array<string | null>;
  deliveryPointIds: Array<string | null>;
}

/**
 * Makes sure every master point a load uses has a map pin and its arrival geofence, whichever
 * way the point was saved: through the masters screens, typed on Post a load, or added before the
 * geofence syncs existed. A point without a pin is pinned from its address first (pinForAddress)
 * and the pin saved on the point. A point that already has its geofence is left alone, so this is
 * cheap to call on every post.
 *
 * The geofence itself is written by the masters' own syncs (LoadingPointGeofenceSync,
 * CustomerDeliveryPointGeofenceSync), so it looks the same as one made from the masters screens.
 */
export class MasterPointGeofences {
  constructor(
    private readonly dataSource: DataSource,
    private readonly geofences: Pick<
      GeofenceRepository,
      'findByLoadingPointId' | 'findByCustomerId'
    >,
    private readonly loadingPointSync: Pick<LoadingPointGeofenceSync, 'upsert'>,
    private readonly deliveryPointSync: Pick<CustomerDeliveryPointGeofenceSync, 'sync'>,
    private readonly pinLookup?: AddressPinLookup,
  ) {}

  async ensure(tenantId: string, points: TripMasterPoints, actorId: string | null): Promise<void> {
    try {
      for (const id of new Set(points.loadingPointIds.filter((value) => value !== null))) {
        await this.ensureLoadingPoint(tenantId, id, actorId);
      }
      for (const id of new Set(points.deliveryPointIds.filter((value) => value !== null))) {
        await this.ensureDeliveryPoint(tenantId, id, actorId);
      }
    } catch (error) {
      rethrow(error, 'Failed to create the geofences of the loading / unloading points');
    }
  }

  private async ensureLoadingPoint(
    tenantId: string,
    id: string,
    actorId: string | null,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(LoadingPointEntity);
    const point = await repo.findOneBy({ id, tenantId, deletedAt: IsNull() });
    if (!point || (await this.geofences.findByLoadingPointId(tenantId, id))) return;
    if (point.latitude === null || point.longitude === null) {
      const pin = await pinForAddress(this.pinLookup, point);
      if (!pin) return;
      point.latitude = String(pin.latitude);
      point.longitude = String(pin.longitude);
      await repo.update({ id, tenantId }, { latitude: point.latitude, longitude: point.longitude });
    }
    await this.loadingPointSync.upsert(point, actorId);
  }

  private async ensureDeliveryPoint(
    tenantId: string,
    id: string,
    actorId: string | null,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(CustomerDeliveryPointEntity);
    const point = await repo.findOneBy({ id, tenantId, deletedAt: IsNull() });
    if (!point) return;
    const fenced = await this.geofences.findByCustomerId(tenantId, point.customerId);
    if (fenced.some((geofence) => geofence.customerDeliveryPointId === id)) return;
    if (point.latitude === null || point.longitude === null) {
      const pin = await pinForAddress(this.pinLookup, { ...point, title: point.location });
      if (!pin) return;
      await repo.update(
        { id, tenantId },
        { latitude: String(pin.latitude), longitude: String(pin.longitude) },
      );
    }
    // The sync works customer-wide (it also tidies geofences of removed points), so it is given
    // the customer with its points as they are now.
    const customer = await this.dataSource.getRepository(CustomerEntity).findOne({
      where: { id: point.customerId, tenantId, deletedAt: IsNull() },
      relations: { deliveryPoints: true },
    });
    if (customer) await this.deliveryPointSync.sync(customer, actorId);
  }
}
