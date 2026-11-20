import { DataSource, In, IsNull } from 'typeorm';
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
 * Works out how a load's truck can be tracked right now: GPS comes from the vehicle master (own
 * fleet: has_gps + gps_enabled); the driver's mobile counts when the load's driver has logged into
 * the app at least once (a masters.driver_sessions row — revoked and expired ones too, so it means
 * "has logged in", not "is installed now"); otherwise SIM when the load has a valid driver number;
 * otherwise the truck number means FASTag. Shared by the assignment hook and the driver-login
 * re-evaluation below, so the priority lives in one place.
 */
export function createTrackingSourceResolver(dataSource: DataSource) {
  const telemetry = dataSource.getRepository(VehicleTelemetryMetaEntity);
  const sessions = dataSource.getRepository(DriverSessionEntity);
  return async (
    load: Pick<
      LoadEntity,
      'tenantId' | 'vehicleId' | 'driverId' | 'driverNumber' | 'vehicleNumber'
    >,
  ): Promise<TrackingSource | null> => {
    const meta = load.vehicleId
      ? await telemetry.findOneBy({ tenantId: load.tenantId, vehicleId: load.vehicleId })
      : null;
    const hasGps = Boolean(meta?.hasGps && meta.gpsEnabled);
    // Only looked up when GPS does not already decide.
    const hasDriverApp =
      !hasGps && load.driverId ? await sessions.existsBy({ driverId: load.driverId }) : false;
    return initialTrackingSource({
      hasGps,
      hasDriverApp,
      hasDriverNumber: hasMobileNumber(load.driverNumber),
      hasVehicleNumber: Boolean(load.vehicleNumber),
    });
  };
}

/**
 * Stage hook: when a truck is assigned to a load, save how it will be tracked on
 * loads.tracking_source (see createTrackingSourceResolver for the order). Decided on assignment;
 * a load saved as `sim`/`fastag` is moved to `driver_app` later by
 * createDriverTrackingReevaluator when the driver logs into the app. Live tracking itself
 * (consent, pings) belongs to the tracking service, which reads the column.
 */
export function createTrackingSourceHook(dataSource: DataSource, loadRepository: LoadRepository) {
  const resolveSource = createTrackingSourceResolver(dataSource);
  return async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (to !== 'truck_assigned') return;
    const trackingSource = await resolveSource(load);
    if (trackingSource !== load.trackingSource) {
      await loadRepository.update(load.tenantId, load.id, { trackingSource });
    }
  };
}

/**
 * Called when a driver logs into the app. A load that was tracked by SIM (or FASTag, or nothing)
 * because the app wasn't there yet is moved to `driver_app`, so the driver's pings are accepted
 * by the tracking service (it only takes phone points for loads whose source is driver_app) and
 * the SIM trip is ended there. Upgrade-only: GPS loads are left alone, and a load is never moved
 * away from `driver_app`. Only loads still on the road are looked at.
 * Returns the ids of the loads that were switched.
 */
export function createDriverTrackingReevaluator(
  dataSource: DataSource,
  loadRepository: LoadRepository,
) {
  const loads = dataSource.getRepository(LoadEntity);
  const resolveSource = createTrackingSourceResolver(dataSource);
  return async (driverId: string): Promise<string[]> => {
    const candidates = await loads.find({
      where: [
        { driverId, status: In([...ON_ROAD_LOAD_STATUSES]), trackingSource: In(['sim', 'fastag']) },
        { driverId, status: In([...ON_ROAD_LOAD_STATUSES]), trackingSource: IsNull() },
      ],
    });
    const switched: string[] = [];
    for (const load of candidates) {
      if (load.podStatus === 'accepted') continue;
      if ((await resolveSource(load)) !== 'driver_app') continue;
      await loadRepository.update(load.tenantId, load.id, { trackingSource: 'driver_app' });
      console.info(
        `[loads] load ${load.id} tracking source ${load.trackingSource ?? 'none'} -> driver_app (driver ${driverId} logged in)`,
      );
      switched.push(load.id);
    }
    return switched;
  };
}
