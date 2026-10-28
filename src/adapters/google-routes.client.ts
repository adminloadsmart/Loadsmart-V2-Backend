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

/**
 * Wraps Google's Routes API (computeRoutes) for road distance and driving time between two
 * points. Only distance and duration are requested (field mask), which keeps the call on the
 * cheapest SKU. Fail-soft: null when the key is missing, Google finds no route, or the call fails —
 * callers fall back to what they already have.
 */
export class GoogleRoutesClient {
  async drivingRoute(origin: LatLng, destination: LatLng): Promise<DrivingRoute | null> {
    if (!env.googleMapsApiKey) return null;
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
      if (!response.ok) return null;
      const body = (await response.json()) as {
        routes?: Array<{ distanceMeters?: number; duration?: string }>;
      };
      const route = body.routes?.[0];
      if (!route?.distanceMeters) return null;
      // Duration comes as e.g. "2700s".
      const durationS = route.duration ? Number.parseFloat(route.duration) : NaN;
      return {
        distanceM: route.distanceMeters,
        durationS: Number.isFinite(durationS) ? durationS : null,
      };
    } catch {
      return null;
    }
  }
}
