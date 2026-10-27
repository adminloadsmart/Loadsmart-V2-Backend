import { DataSource } from 'typeorm';
import { VehicleTelemetryMetaEntity } from '../masters/vehicle/entities/vehicle-telemetry-meta.entity';
import { LoadEntity } from './entities/load.entity';
import { LoadRepository } from './load.repository';
import { LoadStatus } from './utils/loads.types';
import { initialTrackingSource } from './utils/tracking-source';

/**
 * Stage hook: when a truck is assigned to a load, save how it will be tracked on
 * loads.tracking_source. GPS comes from the vehicle master (own fleet: has_gps + gps_enabled);
 * a driver with a driver-app account (loads.driver_id) means the driver's mobile; otherwise the
 * truck number means FASTag. Live tracking itself (pings, switching methods) belongs to the
 * tracking service, which reads and updates the same column.
 */
export function createTrackingSourceHook(dataSource: DataSource, loadRepository: LoadRepository) {
  const telemetry = dataSource.getRepository(VehicleTelemetryMetaEntity);
  return async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (to !== 'truck_assigned') return;
    const meta = load.vehicleId
      ? await telemetry.findOneBy({ tenantId: load.tenantId, vehicleId: load.vehicleId })
      : null;
    const trackingSource = initialTrackingSource({
      hasGps: Boolean(meta?.hasGps && meta.gpsEnabled),
      hasDriverApp: Boolean(load.driverId),
      hasVehicleNumber: Boolean(load.vehicleNumber),
    });
    if (trackingSource !== load.trackingSource) {
      await loadRepository.update(load.tenantId, load.id, { trackingSource });
    }
  };
}
