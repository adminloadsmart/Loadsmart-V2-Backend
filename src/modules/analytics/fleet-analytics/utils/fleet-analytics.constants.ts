import { VehicleAxleType, VehicleOwnershipType } from '../../../masters/vehicle/vehicle.type';
import { TruckBodyType } from '../../../masters/truck-type/truck-type.types';

// Constants for the Fleet Analytics Metric Guide (Loadsmart FMS, v1.0, October 2026). Section
// numbers in comments refer to that document.

/** The date pills on the filter bar. Each preset is whole calendar months ending with last
 *  month, so "6 months" on any day in September reads "Mar to Aug". */
export const FLEET_ANALYTICS_PERIODS = ['last_month', '3_months', '6_months', 'custom'] as const;
export type FleetAnalyticsPeriod = (typeof FLEET_ANALYTICS_PERIODS)[number];

export const PERIOD_MONTHS: Record<Exclude<FleetAnalyticsPeriod, 'custom'>, number> = {
  last_month: 1,
  '3_months': 3,
  '6_months': 6,
};

/** The "Held as" dropdown (§10). `owned_and_attached` is the default and means every vehicle. */
export const FLEET_ANALYTICS_HELD_AS = [
  'owned_and_attached',
  'owned',
  'financed',
  'leased',
  'attached',
] as const;
export type FleetAnalyticsHeldAs = (typeof FLEET_ANALYTICS_HELD_AS)[number];

export const HELD_AS_OWNERSHIP: Record<FleetAnalyticsHeldAs, VehicleOwnershipType[]> = {
  owned_and_attached: ['owned', 'financed', 'leased', 'attached'],
  owned: ['owned'],
  financed: ['financed'],
  leased: ['leased'],
  attached: ['attached'],
};

export const HELD_AS_LABELS: Record<FleetAnalyticsHeldAs, string> = {
  owned_and_attached: 'Owned and Attached',
  owned: 'Owned Outright',
  financed: 'Financed',
  leased: 'Leased',
  attached: 'Attached',
};

/**
 * Body type labels (§2). A 32 ft container sold by axle carries its axle type, and the guide
 * names those as body types of their own (Single Axle, Multi Axle, …), so the axle type wins over
 * the truck type master's body type when both are set.
 */
export const AXLE_BODY_TYPE_LABELS: Record<VehicleAxleType, string> = {
  sxl: 'Single Axle',
  sxl_hc_9_5: 'Single Axle 9.5ft HC',
  sxl_hc_10: 'Single Axle 10ft HC',
  mxl: 'Multi Axle',
  txl: 'Triple Axle',
};

export const TRUCK_BODY_TYPE_LABELS: Record<TruckBodyType, string> = {
  open_body: 'Open Body',
  container: 'Container Body',
  lcv_open_body: 'LCV Open Body',
  lcv_container: 'LCV Container Body',
  trailer_dala_body: 'Trailer Dala Body',
  trailer_flat_bed: 'Trailer Flat Bed',
  tanker: 'Tanker',
  tipper: 'Tipper',
  bulker: 'Bulker',
  mini_pickup: 'Mini Pickup',
};

export const UNCLASSIFIED_BODY_TYPE = 'unclassified';

/** The documents compliance judges (§18). RC is not one of them. */
export const COMPLIANCE_DOCUMENT_TYPES = [
  'insurance',
  'fitness',
  'puc',
  'permit',
  'road_tax',
] as const;

export const DOCUMENT_LABELS: Record<string, string> = {
  insurance: 'Insurance',
  permit: 'Permit',
  puc: 'PUC',
  fitness: 'Fitness certificate',
  road_tax: 'Road tax',
};

/** Compliance windows (§18): within 7 days is 0–7 days left, then 8–30, in order above 30. */
export const EXPIRING_URGENT_DAYS = 7;
export const EXPIRING_SOON_DAYS = 30;

/** On-time (§6): a load is on time if it arrives before the window closes, 4 hours after the due
 *  time. Early arrival is on time. */
export const ON_TIME_WINDOW_MS = 4 * 60 * 60 * 1000;

/** On-time colour bands (§6): green from 85%, orange from 75%, red below. */
export const ON_TIME_GOOD_PCT = 85;
export const ON_TIME_FAIR_PCT = 75;

/** Preventive share of jobs is good above this (§16). */
export const PREVENTIVE_SHARE_GOOD_PCT = 60;

/** National Permit default (§7): ₹16,500 consolidated fee + ₹1,000 home-state authorisation. */
export const NATIONAL_PERMIT_YEARLY_FEE = 17_500;

/** Days a month and a year in the daily fixed cost (§7). */
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 365;

/** Tyres (§16): tread is judged above the 1.6 mm legal floor. */
export const TYRE_LEGAL_FLOOR_MM = 1.6;
/** At or below this the position needs a retread or replacement… */
export const TYRE_WORN_MM = 4;
/** …and at or below this it needs replacing now. */
export const TYRE_REPLACE_NOW_MM = 2;
/** New tread depth by tyre size; any other size falls back to the tyre's recorded original tread. */
export const TYRE_NEW_TREAD_MM: Record<string, number> = {
  '295/80R22.5': 14.5,
  '235/75R17.5': 12,
  '215/75R15': 9,
};
/** A retread casing starts with this share of a new tyre's tread. */
export const TYRE_RETREAD_FACTOR = 0.78;

/** Row caps for the ranked lists (§12–17). */
export const TOP_LANES_BY_COST = 8;
export const LEAST_USED_TRUCKS_LIMIT = 12;
export const IDLE_TRUCKS_LIMIT = 12;
export const TRUCKS_BY_COST_LIMIT = 14;
export const MAINTENANCE_BY_VEHICLE_LIMIT = 12;
export const ON_TIME_BY_LANE_LIMIT = 12;
export const RENEW_THIS_WEEK_LIMIT = 10;
export const REPLACEMENT_CANDIDATES_LIMIT = 10;

/** Load stages for "Where the loads are" (§17). `running_to_loading` has no backing load status
 *  yet, so it always reads 0. */
export const LOAD_STAGES = [
  'created',
  'assigned',
  'running_to_loading',
  'at_loading_point',
  'loaded',
  'in_transit',
  'reached_delivery',
  'unloaded',
  'pod_received',
  'closed',
] as const;

/** Loads still on the road: assigned to a truck, not yet unloaded (§17 "On the road now"). */
export const ON_THE_ROAD_STATUSES = [
  'assigned',
  'at_plant',
  'loading_confirmed',
  'in_transit',
  'reached_delivery_point',
] as const;

/** Replacement candidates (interim): trucks this young or younger set the "new truck" cost per
 *  km for their class, provided a class has at least MIN_BENCHMARK_TRUCKS of them. */
export const NEW_TRUCK_MAX_AGE_YEARS = 2;
export const MIN_BENCHMARK_TRUCKS = 2;

/** Findings: how many plain sentences the Findings section shows. */
export const FINDINGS_LIMIT = 4;

/**
 * Figures the guide defines but this build has no source records for. Each tab returns the
 * entries that apply to it under `unavailable`, so a 0 is never read as a measurement.
 */
export const UNAVAILABLE_REASONS = {
  gps: 'Needs GPS tracking (loaded and empty km, gate times, halts), which is not captured yet.',
  plannedDistance:
    'Needs the planned road distance of each load (Mappls routing), which is not integrated yet.',
  fuel: 'No fuel bills, fuel sensor data or EV charging logs are recorded yet.',
  tolls: 'Toll crossings (ULIP FASTag) are not recorded yet.',
  eChallans: 'E-challans (Parivahan) are not recorded yet.',
  tripExpenses:
    'Trip expenses (bhatta settlement, loading labour, parking, weighbridge, unapproved detention) are not recorded yet.',
  hire: 'Hire and rental for attached trucks (vendor agreements) are not recorded yet.',
  truckPrice:
    'Trucks carry no on-road price or purchase date yet, so depreciation and written-down value cannot be worked out.',
  statePermitFee:
    'Permit cost is charged only for trucks VAHAN lists with a National Permit (₹17,500 a year); state permit fees are not recorded yet.',
  weight:
    'Load weight from the E-LR is not recorded yet; the planned tonnage of each load is used.',
  promisedTime:
    'Only a promised delivery date is recorded, so the due time is the end of that day; loads with no promised date are left out.',
  freeHours: 'Customer free hours and detention rules are not recorded yet.',
  drivingEvents: 'Driving events (overspeed, harsh braking) are not recorded yet.',
  registrationAge:
    'No purchase date is recorded, so age is counted from the VAHAN registration date.',
  tyreRatedLife: 'Tyres have no rated life, so a position with no tread reading is left out.',
  replacementFormula:
    'The guide’s new-truck comparison needs truck prices; this list compares against the youngest trucks of the same type instead.',
  perTripHire:
    'Per-trip hired trucks cannot be told apart from rented ones yet, so every attached truck is listed.',
} as const;
export type UnavailableKey = keyof typeof UNAVAILABLE_REASONS;
