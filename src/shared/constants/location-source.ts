/** How a map point was captured: a Google Places pick ("Google Places · pin confirmed") or typed
 *  in by hand ("entered by … · unverified"). Shared by loading points and customer delivery points. */
export const LOCATION_SOURCES = ['google_places', 'manual'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

/** Default arrival geofence around a loading/unloading point, in metres. */
export const DEFAULT_GEOFENCE_RADIUS_M = 300;

/** google_places only when the client sent a place id AND a pin — otherwise it's a manual entry. */
export function resolveLocationSource(input: {
  googlePlaceId?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}): LocationSource {
  return input.googlePlaceId &&
    input.latitude !== null &&
    input.latitude !== undefined &&
    input.longitude !== null &&
    input.longitude !== undefined
    ? 'google_places'
    : 'manual';
}
