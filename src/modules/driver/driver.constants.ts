/**
 * Sarathi's standard driving-licence number, once spaces and hyphens are stripped: 2-letter state
 * code, 2-digit RTO code, 4-digit year of issue, 7-digit serial — e.g. "MH-12 2019 0012345" →
 * "MH1220190012345". Licences in older non-standard state formats don't match and are rejected.
 */
export const DRIVING_LICENCE_REGEX = /^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/;

/** A driver's score only means something after this many trips — until then they read as `new`. */
export const MIN_SCORED_TRIPS = 5;
