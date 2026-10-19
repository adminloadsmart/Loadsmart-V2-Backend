import { DEFAULT_GEOFENCE_RADIUS_M } from '../../shared/constants/location-source';
import type { GeofenceRepository } from '../geofences/geofence.repository';
import { GeofenceArea, geofenceContains } from '../geofences/utils/geofence.geo';
import {
  GeofenceType,
  HALT_EXPECTED_GEOFENCE_TYPES,
  HaltExpectedGeofenceType,
} from '../geofences/utils/geofence.types';
import { distanceMetresBetween } from './utils/trip-time';

/**
 * LS_N_0027 (vehicle halted) — the places where a long halt is expected and so not alerted: the
 * trip's origin and destination, rest stops and toll plazas. Everything is a geofence (Tracking →
 * Geofences), checked with its real shape (circle or polygon):
 *  - origin: the loading_point geofence linked to the trip's pickup loading point;
 *  - destination: the unloading_point geofence linked to its drop (delivery point, or a loading
 *    point for a posted load) — the same links tracking uses for trip.arrived_at_pickup/_drop;
 *  - rest_stop / toll_plaza geofences the tenant has drawn.
 * A pickup / drop with no linked geofence falls back to its master pin + geofence radius. Other
 * types (yard, fuel pump, no-go area) never excuse a halt. Tracking may also tag the halt itself
 * (`stopPlaceKind` on its HALT-GPS alert), which is honoured as-is.
 */
export type HaltExclusionKind = 'origin' | 'destination' | HaltExpectedGeofenceType;

/** The geofence types the halt check reads. */
export const HALT_CHECK_GEOFENCE_TYPES: readonly GeofenceType[] = [
  'loading_point',
  'unloading_point',
  ...HALT_EXPECTED_GEOFENCE_TYPES,
];

/** One active geofence as the halt check sees it. */
export interface HaltGeofence extends GeofenceArea {
  type: GeofenceType;
  name: string;
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
}

/** The tenant's active HALT_CHECK_GEOFENCE_TYPES geofences. */
export interface HaltGeofences {
  list(tenantId: string): Promise<HaltGeofence[]>;
}

export function createHaltGeofences(
  repository: Pick<GeofenceRepository, 'listActiveByTypes'>,
): HaltGeofences {
  return {
    async list(tenantId) {
      const rows = await repository.listActiveByTypes(tenantId, HALT_CHECK_GEOFENCE_TYPES);
      return rows.map((row) => ({
        type: row.type,
        name: row.name,
        shape: row.shape,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        radiusM: row.radiusM,
        polygon: row.polygon,
        loadingPointId: row.loadingPointId,
        customerDeliveryPointId: row.customerDeliveryPointId,
      }));
    },
  };
}

interface Point {
  lat: number;
  lng: number;
}

/** A trip end: its master point id(s) — what a geofence links to — and the master pin. */
export interface TripEnd {
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
  /** The master point's pin and geofence radius (null = default) — used only when no geofence
   *  is linked to the point. */
  pin: (Point & { radiusM: number | null }) | null;
}

/** `stopPlaceKind` as tracking may send it on a HALT-GPS alert — anything else is ignored. */
export function stopPlaceKindOf(value: unknown): HaltExpectedGeofenceType | null {
  return typeof value === 'string' &&
    (HALT_EXPECTED_GEOFENCE_TYPES as readonly string[]).includes(value)
    ? (value as HaltExpectedGeofenceType)
    : null;
}

/** Inside the trip end: its linked geofence(s) when it has any, else the master pin + radius. */
function insideTripEnd(anchor: Point, end: TripEnd | null, linked: HaltGeofence[]): boolean {
  if (!end) return false;
  if (linked.length > 0) return linked.some((geofence) => geofenceContains(geofence, anchor));
  return (
    end.pin !== null &&
    distanceMetresBetween(anchor, end.pin) <= (end.pin.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M)
  );
}

/** Why this halt is expected, or null when it isn't (and may be alerted). */
export async function findHaltExclusion(input: {
  tenantId: string;
  anchor: Point;
  origin: TripEnd | null;
  destination: TripEnd | null;
  trackingStopPlaceKind: HaltExpectedGeofenceType | null;
  geofences: HaltGeofences;
}): Promise<{ kind: HaltExclusionKind; name: string | null } | null> {
  if (input.trackingStopPlaceKind) return { kind: input.trackingStopPlaceKind, name: null };
  const { anchor, origin, destination } = input;
  const geofences = await input.geofences.list(input.tenantId);

  const originGeofences = geofences.filter(
    (g) =>
      g.type === 'loading_point' &&
      origin?.loadingPointId != null &&
      g.loadingPointId === origin.loadingPointId,
  );
  if (insideTripEnd(anchor, origin, originGeofences)) return { kind: 'origin', name: null };

  const destinationGeofences = geofences.filter(
    (g) =>
      g.type === 'unloading_point' &&
      ((destination?.customerDeliveryPointId != null &&
        g.customerDeliveryPointId === destination.customerDeliveryPointId) ||
        (destination?.loadingPointId != null && g.loadingPointId === destination.loadingPointId)),
  );
  if (insideTripEnd(anchor, destination, destinationGeofences))
    return { kind: 'destination', name: null };

  const stop = geofences.find(
    (g) =>
      (HALT_EXPECTED_GEOFENCE_TYPES as readonly string[]).includes(g.type) &&
      geofenceContains(g, anchor),
  );
  return stop ? { kind: stop.type as HaltExpectedGeofenceType, name: stop.name } : null;
}
