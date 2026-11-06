// Constants for the Shipper Analytics Metric Guide (v1.0, October 2026). Section numbers in the
// comments refer to that document. Every threshold the guide names lives here, so a rule can be
// read against the guide in one place.

/** §1 / §6 — the period filter. Presets end today; the previous period is the same length just
 *  before it. */
export const SHIPPER_ANALYTICS_PERIODS = [
  '1_month',
  '3_months',
  '6_months',
  '12_months',
  '18_months',
  'custom',
] as const;
export type ShipperAnalyticsPeriod = (typeof SHIPPER_ANALYTICS_PERIODS)[number];

export const SHIPPER_PERIOD_MONTHS: Record<Exclude<ShipperAnalyticsPeriod, 'custom'>, number> = {
  '1_month': 1,
  '3_months': 3,
  '6_months': 6,
  '12_months': 12,
  '18_months': 18,
};

/** §6 "Bought as". */
export const BUY_METHODS = ['own_fleet', 'contract', 'spot'] as const;
export type BuyMethod = (typeof BUY_METHODS)[number];

/** §8 — the Freight Spend toggle. */
export const SPEND_MEASURES = ['spend', 'loads', 'tonnes'] as const;
export type SpendMeasure = (typeof SPEND_MEASURES)[number];

// ─── §1 Definitions ──────────────────────────────────────────────────────────

/** Graded transporter: 8 or more delivered loads in the period; fewer is unrated. */
export const GRADED_MIN_DELIVERED = 8;

// ─── §3 On-time delivery (same rule as Fleet Analytics) ──────────────────────

/** Calculated arrival when no promise is entered: Loaded time + Planned distance ÷ 300 km/day. */
export const PLANNED_KM_PER_DAY = 300;

/** On-time colours: green from 85 %, orange from 75 %, red below. */
export const ON_TIME_GREEN_FROM = 85;
export const ON_TIME_ORANGE_FROM = 75;

// ─── §4 Board benchmark ──────────────────────────────────────────────────────

/** Only lanes with 8 or more board awards get a benchmark. */
export const BENCHMARK_MIN_AWARDS = 8;

// ─── §7 Overview ─────────────────────────────────────────────────────────────

export const ATTENTION_LIMIT = 5;
/** Rule 1 — spend change minus tonnes change above 5 points. */
export const ATTENTION_SPEND_VS_TONNES_POINTS = 5;
/** Rule 2 — lanes with 8+ loads whose ₹/tonne-km is above 1.25 × the median lane. */
export const ATTENTION_DEAR_LANE_MIN_LOADS = 8;
export const ATTENTION_DEAR_LANE_FACTOR = 1.25;
/** Rule 3 — transporters with 6+ loads, the lowest on-time more than 8 points below all. */
export const ATTENTION_LATE_TRANSPORTER_MIN_LOADS = 6;
export const ATTENTION_LATE_TRANSPORTER_POINTS = 8;
/** Rule 4 — the top commodity's spend above 30 % of Freight spend. */
export const ATTENTION_COMMODITY_SHARE = 30;
/** Rule 5 — held loads above 6 % of deliveries, or 20 % above the previous period's share. */
export const ATTENTION_DETENTION_SHARE = 6;
export const ATTENTION_DETENTION_RISE = 0.2;
/** Rule 6 — cities with 8+ deliveries, the lowest on-time more than 5 points below overall. */
export const ATTENTION_LATE_CITY_MIN_DELIVERIES = 8;
export const ATTENTION_LATE_CITY_POINTS = 5;

/** Product movement — bars show the top 8 by tonnes. */
export const PRODUCT_MOVEMENT_TOP = 8;

/** Transporter performance and dependency — transporters with 3 or more loads. */
export const OVERVIEW_TRANSPORTER_MIN_LOADS = 3;

// ─── §8 Freight Spend ────────────────────────────────────────────────────────

/** By truck type "Filled": green from 90 %, blue from 80 %, amber below. */
export const FILL_GREEN_FROM = 90;
export const FILL_BLUE_FROM = 80;

// ─── §9 Transporters ─────────────────────────────────────────────────────────

export const TOP_CARRIERS = 5;
export const CONCENTRATION_SHARE = 80;
/** Main lanes: its 2 busiest lanes, then "+N more". */
export const MAIN_LANES = 2;

/** Rate against service colour by share of bought spend: over 15 %, 6–15 %, under 6 %. */
export const SHARE_BAND_HIGH = 15;
export const SHARE_BAND_LOW = 6;

/** Score = 40 × On-time + 20 × Clean + 20 × Acceptance + 20 × Rate. */
export const SCORE_WEIGHTS = { onTime: 40, clean: 20, acceptance: 20, rate: 20 } as const;
/** On-time score = (On-time % − 82 %) ÷ 14 %. */
export const SCORE_ON_TIME_FLOOR = 82;
export const SCORE_ON_TIME_SPAN = 14;
/** Clean score = 1 − (Claims ÷ Delivered) ÷ 4 %. */
export const SCORE_CLEAN_SPAN = 4;
/** Acceptance score = (Acceptance − 78 %) ÷ 18 %. */
export const SCORE_ACCEPTANCE_FLOOR = 78;
export const SCORE_ACCEPTANCE_SPAN = 18;
/** Rate score = 1 − (Rate against the board + 3 %) ÷ 16 %; 0.5 if no benchmark. */
export const SCORE_RATE_OFFSET = 3;
export const SCORE_RATE_SPAN = 16;
export const SCORE_RATE_NO_BENCHMARK = 0.5;

/** Grade: A 78+, B 62–77, C 45–61, D below 45. */
export const GRADE_A_FROM = 78;
export const GRADE_B_FROM = 62;
export const GRADE_C_FROM = 45;
export const TRANSPORTER_GRADES = ['A', 'B', 'C', 'D'] as const;
export type TransporterGrade = (typeof TRANSPORTER_GRADES)[number];

/** Dependency risk — lanes with 5 or more loads. */
export const DEPENDENCY_MIN_LOADS = 5;
/** Qualified alternative: on the roster, serves the destination, 85 %+ on-time. */
export const QUALIFIED_ON_TIME = 85;
/** Red: share above 60 % and 3 or fewer alternatives. Amber: share above 50 % or 4 or fewer. */
export const DEPENDENCY_RED_SHARE = 60;
export const DEPENDENCY_RED_ALTERNATIVES = 3;
export const DEPENDENCY_AMBER_SHARE = 50;
export const DEPENDENCY_AMBER_ALTERNATIVES = 4;
/** Dividing lines at 55 % and 4 alternatives. */
export const DEPENDENCY_DIVIDER_SHARE = 55;
export const DEPENDENCY_DIVIDER_ALTERNATIVES = 4;

// ─── §10 Service ─────────────────────────────────────────────────────────────

/** Loading completed: (Loaded − Placement) within 1.5 × the plant's declared turnaround. */
export const LOADING_TURNAROUND_FACTOR = 1.5;
/** Transit: (Delivery − Loaded) within Planned distance ÷ 300 days + 6 hours. */
export const TRANSIT_GRACE_HOURS = 6;
/** On-time by month — the lane table: lanes with 6+ deliveries, the 8 with the lowest on-time. */
export const SLIPPING_LANE_MIN_DELIVERIES = 6;
export const SLIPPING_LANES = 8;

/** Why loads ran late — the owner of each reason. */
export const DELAY_OWNERS = ['transporter', 'our_plant', 'consignee', 'external'] as const;
export type DelayOwner = (typeof DELAY_OWNERS)[number];

export const DELAY_REASONS = [
  'vehicle_placement_delay',
  'loading_delay_at_plant',
  'transporter_transit_delay',
  'consignee_unloading_delay',
  'external',
  'unattributed',
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];

export const DELAY_REASON_OWNER: Record<DelayReason, DelayOwner | null> = {
  vehicle_placement_delay: 'transporter',
  loading_delay_at_plant: 'our_plant',
  transporter_transit_delay: 'transporter',
  consignee_unloading_delay: 'consignee',
  external: 'external',
  unattributed: null,
};

/** Issue-report categories ops use for the guide's external reasons (weather, road closure,
 *  bandh, strike). Documentation delays have no category yet. */
export const EXTERNAL_ISSUE_CATEGORIES = ['weather', 'road_blocked', 'strike'] as const;

/** Turnaround, as a spread — the six measures behind the switch. */
export const TURNAROUND_MEASURES = [
  'order_to_placement',
  'loading',
  'transit',
  'detention_at_drop',
  'pod_turnaround',
  'invoice_to_settled',
] as const;
export type TurnaroundMeasure = (typeof TURNAROUND_MEASURES)[number];

// ─── §11 Billing ─────────────────────────────────────────────────────────────

/** Where the leakage sits — top 14 rows. */
export const LEAKAGE_TOP = 14;
export const LEAKAGE_VIEWS = ['charge_head', 'transporter', 'lane', 'customer'] as const;
export type LeakageView = (typeof LEAKAGE_VIEWS)[number];

// ─── Unavailable sources ─────────────────────────────────────────────────────

/**
 * Sources the guide names that this build does not record yet. A figure that depends on one is
 * returned as null and its key is listed under `meta.unavailable` with the reason, so nothing is
 * shown as a measurement when it is not one. No figure is approximated.
 */
export const UNAVAILABLE_REASONS = {
  plannedDistance:
    'Needs the planned road distance of each load (Mappls routing), which is not integrated yet.',
  freightPayable:
    'Needs Freight Payable records (transporter invoices, charge heads, disputes, debit notes), which are not recorded yet.',
  boardRates: 'Needs Loadsmart load board rates, which are not available yet.',
  ownFleetRunningCost:
    'Own-fleet loads carry only their fixed cost; running and empty-run cost need GPS and planned distance, which are not recorded yet.',
  missingWeight:
    'Loads without an E-LR weighbridge weight are left out of tonne figures until it is entered.',
  missingTurnaround:
    'Loads from plants without a declared loading turnaround are left out of this figure.',
  noPromise:
    'Loads without a promised delivery date are left out: the calculated arrival needs the planned distance.',
  awardHistory:
    'Award outcomes (won, accepted, refused, no truck) are recorded from this release onward; earlier loads have none.',
  documentationDelays: 'Documentation delays are not tagged by ops yet.',
  missingCost:
    'Bought loads with no agreed rate and no invoice are left out of spend until a rate is recorded.',
  settledOnly:
    'Transporter spend uses the settled amount (§9), so only loads paid in full are counted.',
  accessorialHeads:
    'FOV and sundry charges are not recorded yet; only approved loading, unloading and detention charges are included.',
} as const;
export type UnavailableKey = keyof typeof UNAVAILABLE_REASONS;
