/** Legal minimum tread depth for a goods vehicle tyre — rule 94 of the Central Motor Vehicle
 *  Rules, 1989. Everything the tyres queue says about "running out" is measured against this. */
export const LEGAL_TREAD_FLOOR_MM = 1.6;

/** A position is "near the end" once less than this share of its usable tread (original down to
 *  the legal floor) is left — the second number under the tyres headline. */
export const TREAD_WARN_PCT = 30;

/** A position also enters the tyres queue when it will reach the legal floor within this many
 *  days, even with more than TREAD_WARN_PCT left — a fast-wearing position needs ordering early. */
export const TYRE_QUEUE_HORIZON_DAYS = 30;

/** Fallbacks when a vehicle has no service policy of its own (vehicle_service_usage's
 *  service_interval_km / service_interval_months left null). */
export const DEFAULT_SERVICE_INTERVAL_KM = 20000;
export const DEFAULT_SERVICE_INTERVAL_MONTHS = 6;

/** Assumed wear for a position with no gauge reading yet, or no distance run since fitment to
 *  derive its own rate from — a typical Indian truck tyre loses ~16mm over ~100,000 km. Figures
 *  that lean on it are returned `estimated: true`. */
export const DEFAULT_TYRE_WEAR_MM_PER_1000KM = 0.15;

/** Assumed daily running when a vehicle's own average can't be derived (no odometer history). */
export const DEFAULT_AVG_DAILY_KM = 250;

/** Default warranty State-of-Health floor for a battery pack, when the pack's own terms don't say. */
export const DEFAULT_BATTERY_WARRANTY_SOH_FLOOR_PCT = 70;

/** Default retreads a casing can take before it is scrapped. */
export const DEFAULT_MAX_RETREADS = 2;

/** Fixed monthly cost → per-day, for "the fixed cost that ran anyway" during downtime. */
export const DAYS_PER_MONTH = 30;

export const DEFAULT_OVERVIEW_FILTER = 'last30days' as const;
