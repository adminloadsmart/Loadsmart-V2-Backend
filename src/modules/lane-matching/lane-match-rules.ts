import {
  GeoPoint,
  canonicalCity,
  canonicalState,
  normalizePlace,
  regionNamed,
} from './india-regions';

/**
 * Which brokers and transporters a load goes to: "only those whose lane matches the load's route,
 * or whose lane the route lies in between". Pure — no DB, no network.
 *
 * - `lane`: the pickup is at the lane's start and the drop at its end — the same cities, or inside
 *   the lane's states/regions ("Rajasthan → Punjab" takes Jaipur → Ludhiana).
 * - `en_route`: both ends of the load sit on the lane's way, in its direction: each is at a lane
 *   end or within the corridor (the straight line between the lane's two centres, ± corridorKmFor
 *   its length), and the pickup comes before the drop. A Delhi → Mumbai lane takes Jaipur →
 *   Surat, not Surat → Jaipur.
 */

/** Narrowest corridor around a lane, either side of the straight line. */
export const MIN_CORRIDOR_KM = 50;
/** Widest corridor — a long lane's road strays further from the straight line. */
export const MAX_CORRIDOR_KM = 150;
/** The corridor as a share of the lane's length, between the two bounds above. */
export const CORRIDOR_SHARE = 0.15;
/** How far past either lane end (as a share of the lane's length) still counts as on the way. */
export const END_SLACK = 0.05;
/** Most brokers or transporters one load is sent to. */
export const MAX_RECIPIENTS = 50;

export const MATCH_KINDS = ['lane', 'en_route'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

/** One end of a load: what the posting's address says. */
export interface RoutePlace {
  city: string | null;
  state: string | null;
  point: GeoPoint | null;
}

export interface LoadRoute {
  pickup: RoutePlace;
  drop: RoutePlace;
}

/** One end of a lane, resolved: the cities and states it covers, and a point for the corridor. */
export interface LaneEnd {
  label: string;
  /** Canonical city names (city lanes). */
  cities: ReadonlySet<string>;
  /** Canonical state names (state / region lanes). */
  states: ReadonlySet<string>;
  point: GeoPoint | null;
}

export interface Lane {
  from: LaneEnd;
  to: LaneEnd;
}

export interface LaneMatch {
  kind: MatchKind;
  /** "Rajasthan → Punjab" — the lane that matched. */
  lane: string;
  /** Furthest the load's ends are from the lane's line, rounded; 0 when inside the lane's ends. */
  offRouteKm: number;
}

/**
 * A lane end from what was typed: a state or region ("UP", "NCR", "North East") covers its
 * states; anything else is a city, located by `cityPoint` (null when unknown — the lane then
 * matches by name only, never "on the way").
 */
export function laneEndOf(name: string, cityPoint: GeoPoint | null = null): LaneEnd {
  const region = regionNamed(name);
  if (region) {
    return {
      label: region.name,
      cities: new Set(region.cities ?? []),
      states: new Set(region.states),
      point: region.center,
    };
  }
  return {
    label: name.trim(),
    cities: new Set([canonicalCity(name)]),
    states: new Set<string>(),
    point: cityPoint,
  };
}

/** The place is inside a lane end: one of its cities, or in one of its states. */
export function isInside(place: RoutePlace, end: LaneEnd): boolean {
  const city = canonicalCity(place.city);
  if (city && end.cities.has(city)) return true;
  const state = canonicalState(place.state);
  return state !== null && end.states.has(state);
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Where a point falls along the segment a → b: `t` (0 at a, 1 at b, outside 0–1 beyond the ends)
 * and its distance from the segment in km. A flat projection around the segment's middle — close
 * enough at India's scale for a corridor tens of km wide.
 */
export function alongSegment(
  point: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { t: number; distanceKm: number } {
  const lat0 = rad((a.lat + b.lat) / 2);
  const xy = (p: GeoPoint) => ({
    x: rad(p.lng) * Math.cos(lat0) * EARTH_KM,
    y: rad(p.lat) * EARTH_KM,
  });
  const [p, s, e] = [xy(point), xy(a), xy(b)];
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return { t: 0, distanceKm: Math.hypot(p.x - s.x, p.y - s.y) };
  const t = ((p.x - s.x) * dx + (p.y - s.y) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  const distanceKm = Math.hypot(p.x - (s.x + clamped * dx), p.y - (s.y + clamped * dy));
  return { t, distanceKm };
}

/** Half-width of a lane's corridor: 15% of its straight length, 50–150 km. Delhi → Mumbai
 *  (~1,150 km) gets 150 km, taking Jaipur, Surat, Vadodara and Indore; Ahmedabad (~200 km off the
 *  straight line) is not on it. */
export function corridorKmFor(lane: Lane): number {
  if (!lane.from.point || !lane.to.point) return MIN_CORRIDOR_KM;
  const length = haversineKm(lane.from.point, lane.to.point);
  return Math.min(MAX_CORRIDOR_KM, Math.max(MIN_CORRIDOR_KM, length * CORRIDOR_SHARE));
}

/** Where a load's end sits along a lane — 0 at its start, 1 at its end — or null when off it. */
function positionOn(
  place: RoutePlace,
  lane: Lane,
  corridorKm: number,
): { t: number; offKm: number } | null {
  const atStart = isInside(place, lane.from);
  const atEnd = isInside(place, lane.to);
  if (atStart && !atEnd) return { t: 0, offKm: 0 };
  if (atEnd && !atStart) return { t: 1, offKm: 0 };
  if (!place.point || !lane.from.point || !lane.to.point) {
    // Inside both ends (an intrastate lane) with no point to tell where — call it the start.
    return atStart ? { t: 0, offKm: 0 } : null;
  }
  const { t, distanceKm } = alongSegment(place.point, lane.from.point, lane.to.point);
  if (atStart || atEnd) return { t: Math.max(0, Math.min(1, t)), offKm: 0 };
  if (t < -END_SLACK || t > 1 + END_SLACK || distanceKm > corridorKm) return null;
  return { t, offKm: distanceKm };
}

/** How the load matches the lane, or null when it doesn't. */
export function matchLane(
  route: LoadRoute,
  lane: Lane,
  corridorKm: number = corridorKmFor(lane),
): LaneMatch | null {
  const label = `${lane.from.label} → ${lane.to.label}`;
  if (isInside(route.pickup, lane.from) && isInside(route.drop, lane.to)) {
    return { kind: 'lane', lane: label, offRouteKm: 0 };
  }
  const pickup = positionOn(route.pickup, lane, corridorKm);
  const drop = positionOn(route.drop, lane, corridorKm);
  if (!pickup || !drop || pickup.t >= drop.t) return null;
  return {
    kind: 'en_route',
    lane: label,
    offRouteKm: Math.round(Math.max(pickup.offKm, drop.offKm)),
  };
}

/** The best of a party's lanes for the load: `lane` over `en_route`, then the closer one. */
export function bestMatch(route: LoadRoute, lanes: readonly Lane[]): LaneMatch | null {
  let best: LaneMatch | null = null;
  for (const lane of lanes) {
    const match = matchLane(route, lane);
    if (match && (!best || compareMatches(match, best) < 0)) best = match;
  }
  return best;
}

/** Sort order: `lane` first, then the smaller detour. */
export function compareMatches(a: LaneMatch, b: LaneMatch): number {
  return MATCH_KINDS.indexOf(a.kind) - MATCH_KINDS.indexOf(b.kind) || a.offRouteKm - b.offRouteKm;
}

/** Same phone (last 10 digits) — a party is messaged once however many rows it has. */
export function phoneKey(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').slice(-10);
}

/** For a log line or a reason chip: "Exact lane" / "On the way (12 km off)". */
export function describeMatch(match: LaneMatch): string {
  return match.kind === 'lane'
    ? `Runs ${match.lane}`
    : `On the way on ${match.lane}${match.offRouteKm ? ` (${match.offRouteKm} km off)` : ''}`;
}

export { normalizePlace };

/** What a posting's pickup or drop address gives the matcher. */
export interface AddressLike {
  city: string | null;
  state: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export function placeOf(address: AddressLike | null | undefined): RoutePlace {
  const lat = address?.latitude == null ? NaN : Number(address.latitude);
  const lng = address?.longitude == null ? NaN : Number(address.longitude);
  return {
    city: address?.city ?? null,
    state: address?.state ?? null,
    point: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

/** A posting's route, from its pickup and drop addresses. */
export function routeOf(
  pickup: AddressLike | null | undefined,
  drop: AddressLike | null | undefined,
): LoadRoute {
  return { pickup: placeOf(pickup), drop: placeOf(drop) };
}
