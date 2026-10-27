import { TrackingSource } from './loads.types';

/**
 * The tracking method a load starts with once a truck is on it — the first in the chain the
 * truck has: GPS device → driver's mobile (app) → SIM → FASTag. SIM is never the starting
 * method — it needs the driver's YES and a SIM provider, which the tracking service sets later.
 * Null when there is nothing to track with yet (no truck number). The tracking service updates
 * LoadEntity.trackingSource when it switches.
 */
export function initialTrackingSource(truck: {
  hasGps: boolean;
  hasDriverApp: boolean;
  hasVehicleNumber: boolean;
}): TrackingSource | null {
  if (truck.hasGps) return 'gps';
  if (truck.hasDriverApp) return 'driver_app';
  if (truck.hasVehicleNumber) return 'fastag';
  return null;
}
