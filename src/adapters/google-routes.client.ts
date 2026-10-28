import { env } from '../config/env';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A driving route's length and time — all the driver home screen needs. */
export interface DrivingRoute {
  distanceM: number;
  /** Null when Google gives no duration. */
  durationS: number | null;
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 10_000;
let warnedNoKey = false;

/**
 * Wraps Google's Routes API (computeRoutes) for road distance and driving time between two
 * points. Only distance and duration are requested (field mask), which keeps the call on the
 * cheapest SKU. Fail-soft: null when the key is missing, Google finds no route, or the call fails —
 * callers fall back to what they already have. Failures are logged (e.g. the Routes API not being
 * enabled for GOOGLE_MAPS_API_KEY).
 */
export class GoogleRoutesClient {
  async drivingRoute(origin: LatLng, destination: LatLng): Promise<DrivingRoute | null> {
    if (!env.googleMapsApiKey) {
      if (!warnedNoKey) console.warn('[google-routes] GOOGLE_MAPS_API_KEY not configured');
      warnedNoKey = true;
      return null;
    }
    try {
      const response = await fetch(ROUTES_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.googleMapsApiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: {
            location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          regionCode: 'IN',
          units: 'METRIC',
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[google-routes] computeRoutes ${response.status}: ${text.slice(0, 300)}`);
        return null;
      }
      const body = (await response.json()) as {
        routes?: Array<{ distanceMeters?: number; duration?: string }>;
      };
      const route = body.routes?.[0];
      if (!route?.distanceMeters) {
        console.warn('[google-routes] computeRoutes returned no route', { origin, destination });
        return null;
      }
      // Duration comes as e.g. "2700s".
      const durationS = route.duration ? Number.parseFloat(route.duration) : NaN;
      return {
        distanceM: route.distanceMeters,
        durationS: Number.isFinite(durationS) ? durationS : null,
      };
    } catch (err) {
      console.warn('[google-routes] computeRoutes request failed', err);
      return null;
    }
  }
}
