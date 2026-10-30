import { DataSource } from 'typeorm';
import { DriverSessionEntity } from '../driver/entities/driver-session.entity';
import { VehicleTelemetryMetaEntity } from '../masters/vehicle/entities/vehicle-telemetry-meta.entity';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { LoadEntity } from './entities/load.entity';
import { LoadRepository } from './load.repository';
import { LoadStatus } from './utils/loads.types';
import { initialTrackingSource } from './utils/tracking-source';

/** A 10-digit Indian mobile number (a leading 91 / 0 is dropped) — the form the SIM provider accepts. */
function hasMobileNumber(value: string | null): boolean {
  const digits = normalizePhoneNumber(value ?? '');
  const national = digits.length > 10 ? digits.replace(/^(91|0)/, '') : digits;
  return /^[6-9]\d{9}$/.test(national);
}

/**
 * Stage hook: when a truck is assigned to a load, save how it will be tracked on
 * loads.tracking_source. GPS comes from the vehicle master (own fleet: has_gps + gps_enabled);
 * the driver's mobile counts when the load's driver has logged into the app at least once (a
 * masters.driver_sessions row — revoked and expired ones too, so it means "has logged in", not "is
 * installed now"); otherwise SIM when the load has a valid driver number; otherwise the truck
 * number means FASTag. Decided once, on assignment: a load saved as `sim` stays `sim` for now.
 * Live tracking itself (consent, pings) belongs to the tracking service, which reads the column.
 */
export function createTrackingSourceHook(dataSource: DataSource, loadRepository: LoadRepository) {
  const telemetry = dataSource.getRepository(VehicleTelemetryMetaEntity);
  const sessions = dataSource.getRepository(DriverSessionEntity);
  return async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (to !== 'truck_assigned') return;
    const meta = load.vehicleId
      ? await telemetry.findOneBy({ tenantId: load.tenantId, vehicleId: load.vehicleId })
      : null;
    const hasGps = Boolean(meta?.hasGps && meta.gpsEnabled);
    // Only looked up when GPS does not already decide.
    const hasDriverApp =
      !hasGps && load.driverId ? await sessions.existsBy({ driverId: load.driverId }) : false;
    const trackingSource = initialTrackingSource({
      hasGps,
      hasDriverApp,
      hasDriverNumber: hasMobileNumber(load.driverNumber),
      hasVehicleNumber: Boolean(load.vehicleNumber),
    });
    if (trackingSource !== load.trackingSource) {
      await loadRepository.update(load.tenantId, load.id, { trackingSource });
    }
  };
}
