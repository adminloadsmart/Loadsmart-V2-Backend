/** Types of the loadsmart-tracking client (tracking.client.ts): what callers get back, and the
 *  shapes of tracking's JSON responses. */

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

/** A load's SIM-tracking consent as the tracking service summarises it for the console. */
export interface TripSimConsent {
  /** False when the load isn't tracked by SIM (GPS, driver app, FASTag or nothing yet). */
  applicable: boolean;
  /** valid | link_sent | given | unavailable | no_number — null when not applicable. */
  status: string | null;
  /** Masked driver mobile (last 4 digits). */
  phone: string | null;
  sentAt: string | null;
  /** True while no valid consent is on file and the operator supports SIM tracking. */
  canResend: boolean;
  /** Why the link can't be sent again, when it can't. */
  resendBlockedReason: string | null;
  /** What the driver has to do when the operator doesn't use the SMS link (e.g. Jio's missed call). */
  suggestion: string | null;
}

/** The outcome of asking tracking to send the consent SMS again. */
export type SimConsentResendResult =
  { ok: true; consent: TripSimConsent } | { ok: false; status: number; message: string };

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
  /** The load's SIM consent; null when tracking isn't configured or can't be reached. */
  getSimConsent(tenantId: string, loadId: string): Promise<TripSimConsent | null>;
  /** Sends the driver the SIM-consent SMS again. Tracking's refusals (not a SIM load, consent
   *  already valid, trip not being tracked, SIM not configured) come back as `ok: false`. */
  resendSimConsent(tenantId: string, loadId: string): Promise<SimConsentResendResult>;
}

// --- Tracking's JSON responses ---------------------------------------------------------------

export interface TripListResponse {
  data?: {
    trips?: {
      tripId?: string;
      eta?: { projectedDelayMin?: number | null; stale?: boolean } | null;
    }[];
  };
}

export interface TripResponse {
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

export interface SimConsentResponse {
  data?: {
    applicable?: boolean;
    status?: string | null;
    phone?: string | null;
    sentAt?: string | null;
    canResend?: boolean;
    resendBlockedReason?: string | null;
    suggestion?: string | null;
  };
}

export interface ErrorResponse {
  message?: string;
  error?: { message?: string };
}
