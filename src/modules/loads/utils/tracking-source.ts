import { TrackingSource } from './loads.types';
import { TruckTrackingCapabilities } from './load.interface';

/**
 * The tracking method a load starts with once a truck is on it — the first the truck has:
 * GPS device → driver's mobile (app) → SIM (the driver's phone number) → FASTag (the truck number).
 * Null when there is nothing to track with yet. SIM is chosen here, not by the tracking service:
 * the tracking service only reacts to `sim` (asks the driver's consent, then runs the SIM trip),
 * and for now it never switches a load away from it. LoadEntity.trackingSource is read by the
 * tracking service.
 */
/** Sources that follow the truck live — they move the stages themselves. FASTag only sees toll
 *  plazas, so a FASTag-only load counts as untracked. */
export const LIVE_TRACKING_SOURCES: readonly TrackingSource[] = ['gps', 'driver_app', 'sim'];

/** "Manual mark — only with no tracking": a load tracked live doesn't take the shipper's marks,
 *  and gets no "has it started / reached?" reminders. */
export function hasLiveTracking(source: TrackingSource | null): boolean {
  return source !== null && LIVE_TRACKING_SOURCES.includes(source);
}

export function initialTrackingSource(truck: TruckTrackingCapabilities): TrackingSource | null {
  if (truck.hasGps) return 'gps';
  if (truck.hasDriverApp) return 'driver_app';
  if (truck.hasDriverNumber) return 'sim';
  if (truck.hasVehicleNumber) return 'fastag';
  return null;
}
