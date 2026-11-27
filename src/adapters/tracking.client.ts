import { env } from '../config/env';
import { signToken } from '../shared/utils/token';
import {
  MAX_TRIPS_PER_LIST,
  REQUEST_TIMEOUT_MS,
  SERVICE_TOKEN_TTL_SECONDS,
  SERVICE_USER_ID,
  SIM_CONSENT_RESEND_PERMISSION,
} from './tracking.constants';
import type {
  ErrorResponse,
  SimConsentResendResult,
  SimConsentResponse,
  TrackingClient,
  TripEta,
  TripListResponse,
  TripPosition,
  TripResponse,
  TripSimConsent,
} from './tracking.types';

// Callers import the client's types from here.
export type {
  SimConsentResendResult,
  TrackingClient,
  TripEta,
  TripPosition,
  TripSimConsent,
} from './tracking.types';

function toSimConsent(body: SimConsentResponse): TripSimConsent {
  const data = body.data ?? {};
  const applicable = Boolean(data.applicable);
  return {
    applicable,
    status: applicable ? (data.status ?? null) : null,
    phone: data.phone ?? null,
    sentAt: data.sentAt ?? null,
    canResend: applicable && Boolean(data.canResend),
    resendBlockedReason: data.resendBlockedReason ?? null,
    suggestion: data.suggestion ?? null,
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

  async getSimConsent(tenantId: string, loadId: string): Promise<TripSimConsent | null> {
    try {
      const body = await this.get<SimConsentResponse>(
        tenantId,
        `/v1/trips/${encodeURIComponent(loadId)}/sim-consent`,
      );
      return body ? toSimConsent(body) : null;
    } catch (error) {
      console.warn(`Tracking SIM consent lookup failed for load ${loadId}`, error);
      return null;
    }
  }

  async resendSimConsent(tenantId: string, loadId: string): Promise<SimConsentResendResult> {
    if (!this.baseUrl) {
      return { ok: false, status: 503, message: 'Tracking is not configured on this server' };
    }
    try {
      const response = await this.request(
        tenantId,
        `/v1/trips/${encodeURIComponent(loadId)}/sim-consent/resend`,
        { method: 'POST', permissions: [SIM_CONSENT_RESEND_PERMISSION] },
      );
      const body = (await response.json().catch(() => ({}))) as SimConsentResponse & ErrorResponse;
      if (response.ok) return { ok: true, consent: toSimConsent(body) };
      return {
        ok: false,
        status: response.status,
        message:
          body.error?.message ??
          body.message ??
          "Couldn't send the consent link. Please try again.",
      };
    } catch (error) {
      console.warn(`Tracking SIM consent resend failed for load ${loadId}`, error);
      return { ok: false, status: 503, message: "Tracking can't be reached right now" };
    }
  }

  /** GET against tracking as this tenant; null when tracking isn't configured or answers non-2xx. */
  private async get<T>(tenantId: string, path: string): Promise<T | null> {
    if (!this.baseUrl) return null;
    const response = await this.request(tenantId, path);
    return response.ok ? ((await response.json()) as T) : null;
  }

  /** A call to tracking as this tenant. Only call with `baseUrl` set. */
  private request(
    tenantId: string,
    path: string,
    { method = 'GET', permissions = [] }: { method?: 'GET' | 'POST'; permissions?: string[] } = {},
  ): Promise<Response> {
    // A short-lived token scoped to this tenant, signed with the shared JWT secret — tracking's
    // staff auth reads the tenant (and, for actions, the permission) from it.
    const token = signToken(
      {
        id: SERVICE_USER_ID,
        tenantId,
        role: 'system',
        permissions,
        portal: 'organization',
        purpose: 'access',
      },
      SERVICE_TOKEN_TTL_SECONDS,
    );
    return fetch(`${this.baseUrl!.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}
