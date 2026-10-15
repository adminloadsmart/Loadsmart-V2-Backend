import { VehicleOwnershipType } from '../../../masters/vehicle/vehicle.type';

/** The date pills on the filter bar. Each preset is whole calendar months ending with last
 *  month, so "6 months" on any day in September reads "Mar to Aug". */
export const FLEET_ANALYTICS_PERIODS = ['last_month', '3_months', '6_months', 'custom'] as const;
export type FleetAnalyticsPeriod = (typeof FLEET_ANALYTICS_PERIODS)[number];

export const PERIOD_MONTHS: Record<Exclude<FleetAnalyticsPeriod, 'custom'>, number> = {
  last_month: 1,
  '3_months': 3,
  '6_months': 6,
};

/** The "Held as" dropdown. `owned_and_attached` is the default and means every vehicle. */
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
  owned: 'Owned and Outright',
  financed: 'Financed',
  leased: 'Leased',
  attached: 'Attached/Hired',
};

export const DOCUMENT_LABELS: Record<string, string> = {
  rc: 'RC',
  insurance: 'Insurance',
  permit: 'Permit',
  puc: 'PUC',
  fitness: 'Fitness certificate',
  road_tax: 'Road tax',
};

/** Compliance windows: "inside 7 days" is the renew-now list, "inside 30 days" the workable one. */
export const EXPIRING_URGENT_DAYS = 7;
export const EXPIRING_SOON_DAYS = 30;

/** "Tyres past 88% of life": positions with this share of usable tread or less left. */
export const TYRE_PAST_LIFE_LEFT_PCT = 12;

/** Row caps for the ranked lists the design shows. */
export const LEAST_USED_TRUCKS_LIMIT = 12;
export const RENEW_THIS_WEEK_LIMIT = 10;

/** Movement stages for "Where the loads are". `running_to_loading` and `invoiced` have no
 *  backing load status yet, so they always read 0. */
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
  'invoiced',
  'closed',
] as const;

/** Replacement candidates: trucks this young or younger set the "new truck" cost per km for
 *  their class, provided a class has at least MIN_BENCHMARK_TRUCKS of them. */
export const NEW_TRUCK_MAX_AGE_YEARS = 2;
export const MIN_BENCHMARK_TRUCKS = 2;
export const REPLACEMENT_CANDIDATES_LIMIT = 10;

/** A load is on time if it arrives no more than half an hour after the promised delivery (§6.3). */
export const ON_TIME_GRACE_MS = 30 * 60 * 1000;

/** Findings: how many plain sentences the Findings section shows. */
export const FINDINGS_LIMIT = 4;

/**
 * Figures the spec defines but this build has no source records for. Each tab returns the
 * entries that apply to it under `unavailable`, so the screen can say why a figure reads 0
 * instead of presenting the 0 as a measurement.
 */
export const UNAVAILABLE_REASONS = {
  distancePerLoad:
    'Loads do not carry a distance yet, so tonne-km and lane km cannot be worked out.',
  fuel: 'No fuel or charging fills are recorded yet, so energy cost and mileage cannot be worked out.',
  tolls: 'Tolls and FASTag spend are not recorded yet.',
  driverPay: 'Driver pay and daily allowances are not recorded against trips yet.',
  onRoadPrice:
    'Vehicles carry no on-road price, so depreciation (11%) and insurance at 1.7% cannot be worked out; the insurance premium entered on the vehicle is used instead.',
  permitsAllowance: 'There is no permits and taxes allowance on the vehicle record yet.',
  hire: 'Hire paid for attached trucks is not recorded yet.',
  detention: 'Detention needs gate geofence times from tracking, which are not captured yet.',
  workingDayHours: 'Hours by activity need trip telemetry, which is not captured yet.',
  emptyRunning: 'Empty running needs the distance of each leg, which is not captured yet.',
  yard: 'There is no yard model yet, so the yard filter is not applied.',
  drivers: 'Driver availability and safety scores are on the Driver Analytics screen.',
} as const;
export type UnavailableKey = keyof typeof UNAVAILABLE_REASONS;
