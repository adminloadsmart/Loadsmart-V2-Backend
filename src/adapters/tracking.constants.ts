/** Settings of the loadsmart-tracking client (tracking.client.ts). */

export const REQUEST_TIMEOUT_MS = 5000;
/** Tracking's own cap on GET /v1/trips. */
export const MAX_TRIPS_PER_LIST = 500;
export const SERVICE_TOKEN_TTL_SECONDS = 60;
/** Tracking's permission for sending the consent link again (its SIM_CONSENT_RESEND_PERMISSION). */
export const SIM_CONSENT_RESEND_PERMISSION = 'trip.track';
/** Not a real user: tracking only reads the token's tenant, and this backend's own auth rejects
 *  the token (no such user), so it can't be used against our API. */
export const SERVICE_USER_ID = '00000000-0000-0000-0000-000000000000';
