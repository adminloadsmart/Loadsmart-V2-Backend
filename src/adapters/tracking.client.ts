import { env } from '../config/env';
import { signToken } from '../shared/utils/token';

/** A load's live ETA as the tracking service last computed it (every ~15 min, from GPS progress
 *  along the planned route). */
export interface TripEta {
  etaAt: Date;
  remainingKm: number;
  /** No GPS fix for a while — the ETA is the last one computed, not a fresh one. */
  stale: boolean;
  /** Minutes the ETA is behind the promised delivery time (≤ 0 = on time); null when tracking
   *  has no promised time to compare against. */
  projectedDelayMin: number | null;
}

/** The vehicle's last known position on a load. */
export interface TripPosition {
  lat: number;
  lng: number;
  recordedAt: Date;
  stale: boolean;
  /** Tracking's reverse-geocoded address for the position (its `address`); null when tracking
   *  couldn't resolve one (no Google key there, or the lookup failed). */
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
  /** Load ids of the tenant's active trips whose live ETA is past the promised delivery time
   *  (projectedDelayMin > 0, ETA not stale). Null when tracking isn't configured or can't be
   *  reached — callers fall back to what they know without it. */
  listRunningLateTripIds(tenantId: string): Promise<string[] | null>;
}

const REQUEST_TIMEOUT_MS = 5000;
/** Tracking's own cap on GET /v1/trips. */
const MAX_TRIPS_PER_LIST = 500;
const SERVICE_TOKEN_TTL_SECONDS = 60;
/** Not a real user: tracking only reads the token's tenant, and this backend's own auth rejects
 *  the token (no such user), so it can't be used against our API. */
const SERVICE_USER_ID = '00000000-0000-0000-0000-000000000000';

interface TripListResponse {
  data?: {
    trips?: {
      tripId?: string;
      eta?: { projectedDelayMin?: number | null; stale?: boolean } | null;
    }[];
  };
}

interface TripResponse {
  data?: {
    eta?: {
      etaAt?: string;
      remainingKm?: number;
      stale?: boolean;
      projectedDelayMin?: number | null;
    } | null;
    position?: {
      lat?: number;
      lng?: number;
      recordedAt?: string;
      stale?: boolean;
      address?: string | null;
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
    try {
      const body = await this.get<TripResponse>(
        tenantId,
        `/v1/trips/${encodeURIComponent(loadId)}`,
      );
      if (!body) return none;
      const data = body.data;
      const etaAt = validDate(data?.eta?.etaAt);
      const recordedAt = validDate(data?.position?.recordedAt ?? undefined);
      const { lat, lng } = data?.position ?? {};
      const projectedDelayMin = Number(data?.eta?.projectedDelayMin);
      return {
        eta: etaAt
          ? {
              etaAt,
              remainingKm: Number(data?.eta?.remainingKm ?? 0),
              stale: Boolean(data?.eta?.stale),
              projectedDelayMin:
                data?.eta?.projectedDelayMin != null && Number.isFinite(projectedDelayMin)
                  ? projectedDelayMin
                  : null,
            }
          : null,
        position:
          recordedAt && typeof lat === 'number' && typeof lng === 'number'
            ? {
                lat,
                lng,
                recordedAt,
                stale: Boolean(data?.position?.stale),
                placeName: data?.position?.address?.trim() || null,
              }
            : null,
      };
    } catch (error) {
      console.warn(`Tracking lookup failed for load ${loadId}`, error);
      return none;
    }
  }

  async listRunningLateTripIds(tenantId: string): Promise<string[] | null> {
    try {
      const body = await this.get<TripListResponse>(
        tenantId,
        `/v1/trips?state=active&limit=${MAX_TRIPS_PER_LIST}`,
      );
      if (!body) return null;
      return (body.data?.trips ?? [])
        .filter((trip) => !trip.eta?.stale && Number(trip.eta?.projectedDelayMin) > 0)
        .flatMap((trip) => (trip.tripId ? [trip.tripId] : []));
    } catch (error) {
      console.warn(`Tracking trip list failed for tenant ${tenantId}`, error);
      return null;
    }
  }

  /** GET against tracking as this tenant; null when tracking isn't configured or answers non-2xx. */
  private async get<T>(tenantId: string, path: string): Promise<T | null> {
    if (!this.baseUrl) return null;
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
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? ((await response.json()) as T) : null;
  }
}
