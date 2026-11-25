import { FENCED_MASTER_STATUSES } from '../../shared/constants/location-source';
import { rethrow } from '../../shared/errors';
import { GeofenceRepository } from '../geofences/geofence.repository';
import { CustomerDeliveryPointEntity } from './entities/customer-delivery-point.entity';
import { CustomerEntity } from './entities/customer.entity';

/** The address line a geofence shows: street, locality, city, state, PIN. */
function geofenceAddress(point: CustomerDeliveryPointEntity): string {
  const parts = [
    point.addressLine1,
    point.areaLocality,
    point.city,
    point.state,
    point.pinCode,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : point.location;
}

const hasPin = (point: CustomerDeliveryPointEntity) =>
  point.latitude !== null && point.longitude !== null;

/**
 * Keeps one circle geofence (tracking.geofences, type unloading_point) linked to each customer
 * delivery point with a pin, so the tracking service can detect arrival at the drop — the same
 * as LoadingPointGeofenceSync does for loading points. The point's pin + radius are the source of
 * truth for name / address / pin / radius; active follows the customer (on unless the customer is
 * rejected or retired: a pending one's points are already used by trips). Alert rules and recipients edited later in
 * Tracking → Geofences are left alone.
 *
 * Errors are rethrown (as the codebase's usual InternalError), so a failed sync surfaces to the caller.
 */
export class CustomerDeliveryPointGeofenceSync {
  constructor(
    private readonly geofences: Pick<
      GeofenceRepository,
      'findByCustomerId' | 'create' | 'update' | 'softDelete'
    >,
  ) {}

  /** Create / refresh the geofence of each live point; drop the ones whose point is gone. */
  async sync(customer: CustomerEntity, actorId: string | null): Promise<void> {
    try {
      const points = (customer.deliveryPoints ?? []).filter((p) => !p.deletedAt);
      const isActive = FENCED_MASTER_STATUSES.includes(customer.status);
      const existing = await this.geofences.findByCustomerId(customer.tenantId, customer.id);
      const byPoint = new Map(existing.map((g) => [g.customerDeliveryPointId, g]));

      for (const point of points) {
        if (!hasPin(point)) continue;
        const fields = {
          name: `${customer.name} · ${point.city || point.location}`.slice(0, 150),
          address: geofenceAddress(point),
          latitude: point.latitude as string,
          longitude: point.longitude as string,
          shape: 'circle' as const,
          radiusM: point.geofenceRadiusM,
          polygon: null,
          isActive,
          updatedBy: actorId,
        };
        const current = byPoint.get(point.id);
        if (current) {
          await this.geofences.update(customer.tenantId, current.id, fields, {});
          continue;
        }
        await this.geofences.create(
          {
            ...fields,
            tenantId: customer.tenantId,
            type: 'unloading_point',
            alertOnEnter: true,
            alertOnExit: true,
            dwellAlertMinutes: null,
            engineOnAlertMinutes: null,
            appliesToAllVehicles: true,
            loadingPointId: null,
            customerDeliveryPointId: point.id,
            createdBy: actorId,
          },
          { vehicleIds: [], recipients: [] },
        );
      }

      // A point removed (or its pin cleared) takes its geofence with it.
      const kept = new Set(points.filter(hasPin).map((p) => p.id));
      for (const geofence of existing) {
        if (!geofence.deletedAt && !kept.has(geofence.customerDeliveryPointId ?? '')) {
          await this.geofences.softDelete(customer.tenantId, geofence.id);
        }
      }
    } catch (error) {
      rethrow(error, 'Failed to sync unloading point geofences');
    }
  }

  /** Customer deleted: drop every geofence of its points. */
  async remove(tenantId: string, customerId: string): Promise<void> {
    try {
      const existing = await this.geofences.findByCustomerId(tenantId, customerId);
      for (const geofence of existing) await this.geofences.softDelete(tenantId, geofence.id);
    } catch (error) {
      rethrow(error, 'Failed to remove unloading point geofences');
    }
  }
}
