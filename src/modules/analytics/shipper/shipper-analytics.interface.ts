import {
  BuyMethod,
  DelayOwner,
  DelayReason,
  ShipperAnalyticsPeriod,
  SpendMeasure,
  TransporterGrade,
  TurnaroundMeasure,
} from './utils/shipper-analytics.constants';

/**
 * Shipper Analytics responses, per the Shipper Analytics Metric Guide (v1.0, October 2026).
 *
 * Every figure the guide defines is here. A figure whose source is not recorded yet is null, and
 * the reason is listed under `meta.unavailable` (key → reason), so a null is never read as a 0.
 * Money is in rupees, weights in tonnes, shares and on-time in % (one decimal).
 */

// ─── Request ─────────────────────────────────────────────────────────────────

export interface ShipperAnalyticsFilters {
  period: ShipperAnalyticsPeriod;
  from?: string;
  to?: string;
  /** Loading point id. */
  plantId?: string;
  /** Destination city, lower-cased, as /filters returns it. */
  destinationCity?: string;
  /** `${from-city}|${to-city}`, lower-cased. Excludes plantId / destinationCity. */
  laneKey?: string;
  transporterId?: string;
  customerId?: string;
  /** Product id. */
  commodityId?: string;
  bodyType?: string;
  size?: string;
  boughtAs?: BuyMethod;
  businessUnit?: string;
}

export type ShipperFilterKey = Exclude<keyof ShipperAnalyticsFilters, 'period' | 'from' | 'to'>;

// ─── Shared ──────────────────────────────────────────────────────────────────

export interface ShipperPeriodView {
  from: string;
  to: string;
  days: number;
  label: string;
}

export interface ShipperAnalyticsMeta {
  period: { current: ShipperPeriodView; previous: ShipperPeriodView };
  /** Dispatched loads in the selected period, after filters — the loads pill. */
  loadsInWindow: number;
  /** Field (or field prefix) → why it is null or narrowed. */
  unavailable: Record<string, string>;
  /** Set when the filters leave no loads at all: the last filter applied. */
  emptyBecause: ShipperFilterKey | null;
}

/** A tile figure with the previous period and the change (§1 "Change vs previous period"). */
export interface Metric {
  value: number | null;
  previous: number | null;
  /** % for amounts and counts; points for percentages (see `changeKind`). */
  change: number | null;
  changeKind: 'relative' | 'points';
}

export interface Option {
  id: string;
  name: string;
}

export interface MonthPoint {
  /** "YYYY-MM" */
  month: string;
  label: string;
}

export type Tone = 'green' | 'orange' | 'red';

export interface ExecutionStage {
  key: 'tender_accepted' | 'vehicle_placed' | 'loading_completed' | 'transit' | 'delivered_on_time';
  pct: number | null;
  /** "1,433 of 1,532" — loads meeting the stage of the loads that reached it. */
  numerator: number | null;
  denominator: number | null;
  tone: Tone | null;
}

export interface ProductRow {
  commodityId: string;
  name: string;
  tonnes: number | null;
  share: number | null;
  loads: number;
  freight: number;
  perTonne: number | null;
  tonnesPerLoad: number | null;
}

export interface ConcentrationView {
  rows: { id: string; name: string; spend: number; cumulative: number }[];
  topFiveShare: number | null;
  largestShare: number | null;
  carriersTo80: number;
}

export interface RateServicePoint {
  id: string;
  name: string;
  /** ₹ per tonne-km — needs the planned distance. */
  perTonneKm: number | null;
  onTimePct: number | null;
  spend: number;
  sharePct: number | null;
  band: 'high' | 'mid' | 'low';
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface ShipperAnalyticsFilterOptions {
  plants: Option[];
  destinations: Option[];
  lanes: Option[];
  transporters: Option[];
  customers: Option[];
  commodities: Option[];
  bodyTypes: Option[];
  /** Sizes, each with the body type it belongs to. */
  sizes: (Option & { bodyType: string })[];
  boughtAs: Option[];
  businessUnits: Option[];
}

// ─── Overview (§7) ───────────────────────────────────────────────────────────

export type AttentionRule =
  | 'spend_vs_tonnage'
  | 'dear_lane'
  | 'late_transporter'
  | 'commodity_share'
  | 'detention'
  | 'late_destination';

export interface AttentionFinding {
  rule: AttentionRule;
  /** The transporter, commodity or city the finding is about, when there is one. */
  subject: string | null;
  amount: number;
  unit: 'rupees' | 'loads' | 'hours';
  /** The figures the finding was tested on, for its sentence. */
  detail: Record<string, number | null>;
  /** The loads behind the finding. */
  loadIds: string[];
}

export interface ShipperAnalyticsOverview {
  meta: ShipperAnalyticsMeta;
  tiles: {
    freightSpend: Metric & { perTonne: number | null };
    loadsMoved: Metric & { dispatched: number };
    tonnesMoved: Metric & { perLoad: number | null };
    detentionAndClaims: Metric & { held: number; claims: number };
    onTime: Metric & { delivered: number };
    freightPerLoad: Metric & { perTonneKm: number | null };
  };
  attention: AttentionFinding[];
  products: { rows: ProductRow[]; topTwoShare: number | null };
  spendByMonth: (MonthPoint & Record<BuyMethod, number>)[];
  ratePerTonneKm: (MonthPoint & { paid: number | null; boardMedian: number | null })[];
  transporters: { plot: RateServicePoint[]; concentration: ConcentrationView };
  execution: ExecutionStage[];
  goDeeper: {
    freightSpend: number;
    carriersUsed: number;
    onTimePct: number | null;
    leakage: number | null;
  };
}

/**
 * The Overview as a viewer without payments.manage sees it (see withoutOverviewMoney): every
 * rupee figure is dropped — the spend/freight/detention tiles, rupee attention findings, product
 * freight, the spend and rate series, the transporter plot's rate/spend/share and the spend
 * concentration table, and goDeeper's spend/leakage. Counts, tonnes and service figures stay.
 * `meta.moneyHidden` tells the frontend to render "hidden" rather than 0.
 */
export interface ShipperAnalyticsOverviewResponse {
  meta: ShipperAnalyticsMeta & { moneyHidden: boolean };
  tiles: Omit<
    ShipperAnalyticsOverview['tiles'],
    'freightSpend' | 'freightPerLoad' | 'detentionAndClaims'
  > &
    Partial<
      Pick<
        ShipperAnalyticsOverview['tiles'],
        'freightSpend' | 'freightPerLoad' | 'detentionAndClaims'
      >
    >;
  attention: AttentionFinding[];
  products: {
    rows: (Omit<ProductRow, 'freight' | 'perTonne'> &
      Partial<Pick<ProductRow, 'freight' | 'perTonne'>>)[];
    topTwoShare: number | null;
  };
  spendByMonth: ShipperAnalyticsOverview['spendByMonth'];
  ratePerTonneKm: ShipperAnalyticsOverview['ratePerTonneKm'];
  transporters: {
    plot: (Omit<RateServicePoint, 'perTonneKm' | 'spend' | 'sharePct'> &
      Partial<Pick<RateServicePoint, 'perTonneKm' | 'spend' | 'sharePct'>>)[];
    concentration?: ConcentrationView;
  };
  execution: ExecutionStage[];
  goDeeper: Omit<ShipperAnalyticsOverview['goDeeper'], 'freightSpend' | 'leakage'> &
    Partial<Pick<ShipperAnalyticsOverview['goDeeper'], 'freightSpend' | 'leakage'>>;
}

// ─── Freight Spend (§8) ──────────────────────────────────────────────────────

export interface ShipperAnalyticsFreightSpend {
  meta: ShipperAnalyticsMeta;
  measure: SpendMeasure;
  tiles: {
    freightSpend: Metric;
    loadsDispatched: Metric & { destinations: number };
    tonnesMoved: Metric & { perLoad: number | null };
    freightPerLoad: Metric & { perTonneKm: number | null };
    freightPerTonne: Metric & { medianFillPct: number | null };
    ownFleetShare: Metric & { ownFleetCost: number };
  };
  /** Bars in the selected measure. */
  byMonth: (MonthPoint & Record<BuyMethod, number>)[];
  monthRows: (MonthPoint & { loads: number; spend: number; perTonneKm: number | null })[];
  products: { rows: ProductRow[]; topTwoShare: number | null };
  customers: {
    id: string;
    name: string;
    city: string | null;
    loads: number;
    tonnes: number | null;
    spend: number;
    perTonneKm: number | null;
    /** % above (+) or below (−) the overall ₹/tonne-km. */
    vsOverall: number | null;
    onTimePct: number | null;
    onTimeTone: Tone | null;
    detained: number;
  }[];
  /** In the selected measure. */
  commodities: { id: string; name: string; value: number }[];
  businessUnits: { name: string; value: number; loads: number }[];
  truckTypes: {
    key: string;
    bodyType: string;
    size: string | null;
    ratedTonnes: number | null;
    loads: number;
    perTonneKm: number | null;
    filledPct: number | null;
    filledTone: 'green' | 'blue' | 'amber' | null;
  }[];
  /** Null when the period has no own-fleet loads (the section is hidden). */
  ownTrucks: {
    ownPerTonneKm: number | null;
    boughtPerTonneKm: number | null;
    sameLanes: { own: number | null; bought: number | null; lanes: number };
    ownFilledPct: number | null;
    trucks: {
      id: string;
      number: string;
      loads: number;
      tonnes: number | null;
      km: number | null;
      filledPct: number | null;
      tripCost: number;
      perTonneKm: number | null;
    }[];
  } | null;
}

// ─── Transporters (§9) ───────────────────────────────────────────────────────

export interface CarrierRow {
  id: string;
  name: string;
  loads: number;
  tonnes: number | null;
  spend: number;
  perTonneKm: number | null;
  onTimePct: number | null;
  onTimeTone: Tone | null;
  placedPct: number | null;
  /** Loads with a claim — or loads held, if it has no claims. */
  claims: number;
  claimsAreHeld: boolean;
  mainLanes: string[];
  moreLanes: number;
  delivered: number;
  acceptancePct: number | null;
  score: number | null;
  grade: TransporterGrade | null;
}

export interface ShipperAnalyticsTransporters {
  meta: ShipperAnalyticsMeta;
  tiles: {
    carriersUsed: Metric & { roster: number };
    topFiveShare: Metric;
    tenderAcceptance: Metric;
    placedOnDay: Metric;
    gradeA: { value: number; graded: number; gradeD: number; unrated: number };
    claims: Metric & { claimValue: number };
  };
  rateVsService: {
    points: RateServicePoint[];
    dividers: { perTonneKm: number | null; onTimePct: number | null };
  };
  carriers: CarrierRow[];
  concentration: ConcentrationView;
  dependency: {
    laneKey: string;
    lane: string;
    spend: number;
    sharePct: number;
    largest: Option;
    alternatives: number;
    tone: 'red' | 'amber' | 'green';
  }[];
}

// ─── Service (§10) ───────────────────────────────────────────────────────────

export interface TurnaroundView {
  measure: TurnaroundMeasure;
  unit: 'hours' | 'days';
  histogram: { from: number; to: number; loads: number }[];
  median: number | null;
  p75: number | null;
  p90: number | null;
  worst: number | null;
  measured: number;
}

export interface ShipperAnalyticsService {
  meta: ShipperAnalyticsMeta;
  tiles: {
    onTime: Metric & { delivered: number };
    placedOnDay: Metric;
    cleanAtDrop: Metric & { withClaims: number };
    medianDaysLate: Metric & { p90: number | null };
    loadsDetained: Metric & { hoursBeyondFree: number };
    claimValue: Metric;
  };
  execution: ExecutionStage[];
  lateReasons: {
    rows: { reason: DelayReason; owner: DelayOwner | null; loads: number; cumulative: number }[];
    owners: { owner: DelayOwner; loads: number; share: number | null }[];
    unattributed: number;
    lateLoads: number;
  };
  turnaround: TurnaroundView[];
  onTimeByMonth: (MonthPoint & { deliveredOnTime: number | null; placedOnDay: number | null })[];
  periodAverage: number | null;
  lanes: {
    laneKey: string;
    lane: string;
    delivered: number;
    onTimePct: number | null;
    onTimeTone: Tone | null;
    medianDaysLate: number | null;
    topCarrier: string | null;
  }[];
}

// ─── Billing (§11) ───────────────────────────────────────────────────────────

export interface BridgeLine {
  key:
    | 'awarded'
    | 'rate_variance'
    | 'detention'
    | 'other_accessorials'
    | 'credits_recovered'
    | 'unreconciled'
    | 'settled';
  value: number | null;
  loads: number;
}

export interface LeakageRow {
  id: string;
  label: string;
  value: number | null;
  loads: number;
}

export interface ShipperAnalyticsBilling {
  meta: ShipperAnalyticsMeta;
  tiles: {
    awardedFreight: Metric & { boughtLoads: number };
    settledFreight: Metric & { paidLoads: number };
    leakage: Metric & { pctOfAwarded: number | null; pctChange: number | null };
    avoidable: { value: number | null };
    invoicesDisputed: { pct: number | null; disputed: number | null; open: number | null };
    invoiceToSettled: { medianDays: number | null; p90Days: number | null };
  };
  bridge: BridgeLine[];
  bridgeStats: {
    leakage: number | null;
    pctOfAwarded: number | null;
    recoverable: number | null;
  };
  funnel: {
    awarded: { value: number; loads: number };
    invoiced: { value: number | null; invoices: number | null };
    settled: { value: number; loads: number };
    awardedToInvoicedMismatch: number | null;
    invoicedToSettledMismatch: number | null;
    averageDisputeDays: number | null;
  };
  leakage: Record<'charge_head' | 'transporter' | 'lane' | 'customer', LeakageRow[]>;
  disputes: {
    heads: { head: string; count: number; amount: number }[] | null;
    disputedShare: number | null;
    medianDays: number | null;
    p90Days: number | null;
  };
}
