import { rethrow } from '../../../shared/errors';
import { GeofenceRepository } from '../../geofences/geofence.repository';
import { LoadingPointEntity } from './entities/loading-point.entity';

/** The address line a geofence shows: the Places address when we have it, else city/state/PIN. */
function geofenceAddress(point: LoadingPointEntity): string {
  const parts = [point.addressLine1, point.city, point.state, point.pinCode].filter(Boolean);
  return parts.join(', ');
}

/**
 * Keeps one circle geofence (tracking.geofences, type loading_point) linked to each master loading
 * point, so the tracking service can detect arrival there and drive load status. The loading
 * point's pin + radius are the source of truth for name / address / pin / radius / active; alert
 * rules and recipients edited later in Tracking → Geofences are left alone.
 *
 * Errors are rethrown (as the codebase's usual InternalError), so a failed sync surfaces to the caller.
 */
export class LoadingPointGeofenceSync {
  constructor(
    private readonly geofences: Pick<
      GeofenceRepository,
      'findByLoadingPointId' | 'create' | 'update' | 'softDelete'
    >,
  ) {}

  /** Create or refresh the linked geofence. No pin yet → nothing to fence, so no-op. */
  async upsert(point: LoadingPointEntity, actorId: string | null): Promise<void> {
    try {
      if (point.latitude === null || point.longitude === null) return;
      // Only an approved point drives load status; pending / rejected / retired stay inert.
      const isActive = point.status === 'active';
      const existing = await this.geofences.findByLoadingPointId(point.tenantId, point.id);

      if (existing) {
        await this.geofences.update(
          point.tenantId,
          existing.id,
          {
            name: point.title,
            address: geofenceAddress(point),
            latitude: point.latitude,
            longitude: point.longitude,
            shape: 'circle',
            radiusM: point.geofenceRadiusM,
            polygon: null,
            isActive,
            updatedBy: actorId,
          },
          {},
        );
        return;
      }

      await this.geofences.create(
        {
          tenantId: point.tenantId,
          name: point.title,
          type: 'loading_point',
          address: geofenceAddress(point),
          latitude: point.latitude,
          longitude: point.longitude,
          shape: 'circle',
          radiusM: point.geofenceRadiusM,
          polygon: null,
          alertOnEnter: true,
          alertOnExit: true,
          dwellAlertMinutes: null,
          engineOnAlertMinutes: null,
          appliesToAllVehicles: true,
          loadingPointId: point.id,
          customerDeliveryPointId: null,
          isActive,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { vehicleIds: [], recipients: [] },
      );
    } catch (error) {
      rethrow(error, 'Failed to sync loading point geofence');
    }
  }

  /** Loading point deleted: drop its geofence too. */
  async remove(tenantId: string, loadingPointId: string): Promise<void> {
    try {
      const existing = await this.geofences.findByLoadingPointId(tenantId, loadingPointId);
      if (existing) await this.geofences.softDelete(tenantId, existing.id);
    } catch (error) {
      rethrow(error, 'Failed to remove loading point geofence');
    }
  }
}
