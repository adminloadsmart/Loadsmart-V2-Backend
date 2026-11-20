import { DataSource, In, Not } from 'typeorm';
import { DriverSessionEntity } from '../../driver/entities/driver-session.entity';
import { VehicleTelemetryMetaEntity } from '../../masters/vehicle/entities/vehicle-telemetry-meta.entity';
import { normalizePhoneNumber } from '../../../shared/utils/phone-number';
import { LoadEntity } from '../entities/load.entity';
import { LoadRepository } from './load.repository';
import { LoadStatus, ON_ROAD_LOAD_STATUSES, TrackingSource } from '../utils/loads.types';
import { initialTrackingSource } from '../utils/tracking-source';

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
 * number means FASTag. A driver already on a live phone/SIM-tracked load keeps that source for the
 * new load too (the tracking service follows one trip per driver). Decided once, on assignment: a load saved as `sim` stays `sim` for now.
 * Live tracking itself (consent, pings) belongs to the tracking service, which reads the column.
 */
export function createTrackingSourceHook(dataSource: DataSource, loadRepository: LoadRepository) {
  const telemetry = dataSource.getRepository(VehicleTelemetryMetaEntity);
  const sessions = dataSource.getRepository(DriverSessionEntity);
  const loads = dataSource.getRepository(LoadEntity);
  // The tracking service holds one active trip per driver and accepts phone points only for the
  // source that trip names. So while the driver is on another live load tracked by phone/SIM, a
  // new load takes that same source — otherwise its driver_app points would be dropped.
  const driverBusySource = async (load: LoadEntity): Promise<TrackingSource | null> => {
    if (!load.driverId) return null;
    const other = await loads.findOne({
      where: {
        driverId: load.driverId,
        id: Not(load.id),
        status: In([...ON_ROAD_LOAD_STATUSES]),
        trackingSource: In(['driver_app', 'sim']),
      },
      select: { id: true, trackingSource: true },
      order: { createdAt: 'ASC' },
    });
    return other?.trackingSource ?? null;
  };
  return async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (to !== 'truck_assigned') return;
    const meta = load.vehicleId
      ? await telemetry.findOneBy({ tenantId: load.tenantId, vehicleId: load.vehicleId })
      : null;
    const hasGps = Boolean(meta?.hasGps && meta.gpsEnabled);
    // Only looked up when GPS does not already decide.
    const hasDriverApp =
      !hasGps && load.driverId ? await sessions.existsBy({ driverId: load.driverId }) : false;
    const trackingSource =
      (hasGps ? null : await driverBusySource(load)) ??
      initialTrackingSource({
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
