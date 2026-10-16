import { env } from '../config/env';
import { signToken } from '../shared/utils/token';

/** A load's live ETA as the tracking service last computed it (every ~15 min, from GPS progress
 *  along the planned route). */
export interface TripEta {
  etaAt: Date;
  remainingKm: number;
  /** No GPS fix for a while — the ETA is the last one computed, not a fresh one. */
  stale: boolean;
}

/** The vehicle's last known position on a load. */
export interface TripPosition {
  lat: number;
  lng: number;
  recordedAt: Date;
  stale: boolean;
  /** "Khanna, Ludhiana" — once tracking resolves place names (its location resolver). */
  placeName: string | null;
}

/** Read side of the loadsmart-tracking service (a separate repo/process sharing our database and
 *  JWT secret). One load is one trip there, keyed by the load id. */
export interface TrackingClient {
  /** Null when tracking isn't configured, has no ETA for the load yet (no GPS / no planned
   *  route), or can't be reached — callers treat that as "ETA unknown", never as an error. */
  getTripEta(tenantId: string, loadId: string): Promise<TripEta | null>;
  /** Same call; also the vehicle's last position — null when tracking has none for the load
   *  (before tracking watches a load from assignment, it only has one once the trip started). */
  getTrip(
    tenantId: string,
    loadId: string,
  ): Promise<{ eta: TripEta | null; position: TripPosition | null }>;
}

const REQUEST_TIMEOUT_MS = 5000;
const SERVICE_TOKEN_TTL_SECONDS = 60;
/** Not a real user: tracking only reads the token's tenant, and this backend's own auth rejects
 *  the token (no such user), so it can't be used against our API. */
const SERVICE_USER_ID = '00000000-0000-0000-0000-000000000000';

interface TripResponse {
  data?: {
    eta?: { etaAt?: string; remainingKm?: number; stale?: boolean } | null;
    position?: {
      lat?: number;
      lng?: number;
      recordedAt?: string;
      stale?: boolean;
      placeName?: string | null;
    } | null;
  };
}

const validDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export class HttpTrackingClient implements TrackingClient {
  constructor(private readonly baseUrl: string | undefined = env.trackingApiUrl) {}

  async getTripEta(tenantId: string, loadId: string): Promise<TripEta | null> {
    return (await this.getTrip(tenantId, loadId)).eta;
  }

  async getTrip(
    tenantId: string,
    loadId: string,
  ): Promise<{ eta: TripEta | null; position: TripPosition | null }> {
    const none = { eta: null, position: null };
    if (!this.baseUrl) return none;
    // A short-lived token scoped to this tenant, signed with the shared JWT secret — tracking's
    // staff auth reads the tenant from it (see the tracking requirements list).
    const token = signToken(
      {
        id: SERVICE_USER_ID,
        tenantId,
        role: 'system',
        permissions: [],
        portal: 'organization',
        purpose: 'access',
      },
      SERVICE_TOKEN_TTL_SECONDS,
    );
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/+$/, '')}/v1/trips/${encodeURIComponent(loadId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) return none;
      const data = ((await response.json()) as TripResponse).data;
      const etaAt = validDate(data?.eta?.etaAt);
      const recordedAt = validDate(data?.position?.recordedAt ?? undefined);
      const { lat, lng } = data?.position ?? {};
      return {
        eta: etaAt
          ? {
              etaAt,
              remainingKm: Number(data?.eta?.remainingKm ?? 0),
              stale: Boolean(data?.eta?.stale),
            }
          : null,
        position:
          recordedAt && typeof lat === 'number' && typeof lng === 'number'
            ? {
                lat,
                lng,
                recordedAt,
                stale: Boolean(data?.position?.stale),
                placeName: data?.position?.placeName?.trim() || null,
              }
            : null,
      };
    } catch (error) {
      console.warn(`Tracking lookup failed for load ${loadId}`, error);
      return none;
    }
  }
}
