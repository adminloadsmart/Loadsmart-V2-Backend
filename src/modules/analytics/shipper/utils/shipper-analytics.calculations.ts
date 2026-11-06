import { endOfIstDate } from '../../../../shared/utils/ist-time';
import { round } from '../../../maintenance/calculations/dates';
import { money } from '../../../maintenance/calculations/downtime';
import {
  isOnTime as fleetIsOnTime,
  lateDays as fleetLateDays,
} from '../../fleet-analytics/utils/fleet-analytics.calculations';
import {
  BuyMethod,
  DELAY_REASON_OWNER,
  DelayOwner,
  DelayReason,
  DEPENDENCY_AMBER_ALTERNATIVES,
  DEPENDENCY_AMBER_SHARE,
  DEPENDENCY_RED_ALTERNATIVES,
  DEPENDENCY_RED_SHARE,
  FILL_BLUE_FROM,
  FILL_GREEN_FROM,
  GRADE_A_FROM,
  GRADE_B_FROM,
  GRADE_C_FROM,
  GRADED_MIN_DELIVERED,
  LOADING_TURNAROUND_FACTOR,
  ON_TIME_GREEN_FROM,
  ON_TIME_ORANGE_FROM,
  SCORE_ACCEPTANCE_FLOOR,
  SCORE_ACCEPTANCE_SPAN,
  SCORE_CLEAN_SPAN,
  SCORE_ON_TIME_FLOOR,
  SCORE_ON_TIME_SPAN,
  SCORE_RATE_NO_BENCHMARK,
  SCORE_RATE_OFFSET,
  SCORE_RATE_SPAN,
  SCORE_WEIGHTS,
  SHARE_BAND_HIGH,
  SHARE_BAND_LOW,
  TransporterGrade,
} from './shipper-analytics.constants';

// Calculations for the Shipper Analytics Metric Guide (v1.0, October 2026). Every function works
// on LoadFact — one load, already resolved from its entities — so each rule can be tested on its
// own. Section numbers in the comments refer to the guide.

export interface NamedRef {
  id: string;
  name: string;
}

export interface TruckTypeRef {
  /** `${bodyType}|${size}` */
  key: string;
  bodyType: string;
  bodyTypeLabel: string;
  /** "32T" — the truck type master's rated capacity. Null when not on file. */
  size: string | null;
  /** Rated capacity in tonnes. */
  ratedTonnes: number | null;
}

/** One load, with every field the guide reads already resolved (§5 data sources). */
export interface LoadFact {
  id: string;
  code: string;
  buyMethod: BuyMethod;
  /** §1 Bought load: moved by a transporter, on contract or spot. */
  bought: boolean;
  transporter: NamedRef | null;
  customer: (NamedRef & { city: string | null }) | null;
  /** The loading point (plant). */
  plant: NamedRef | null;
  /** Plant master: loading time the plant commits to, in hours. */
  plantTurnaroundHours: number | null;
  destinationCity: string | null;
  /** State of the destination — matched against the transporter master's corridors. */
  destinationState: string | null;
  lane: { key: string; label: string } | null;
  /** §7 Commodity of each load: the first item on the load. */
  commodity: NamedRef | null;
  businessUnit: string | null;
  truckType: TruckTypeRef | null;
  /** Own truck of an own-fleet load. */
  vehicle: NamedRef | null;
  /** E-LR weighbridge gross weight minus tare, tonnes. Null until entered. */
  weight: number | null;

  /** Order / indent raised. */
  orderAt: Date | null;
  /** YYYY-MM-DD — pickup date requested. */
  pickupDate: string | null;
  /** Truck enters the loading point. */
  placementAt: Date | null;
  /** Truck leaves the loading point — the load's loading date. */
  loadedAt: Date | null;
  /** Truck enters the unloading point — the load's delivery date. */
  deliveredAt: Date | null;
  podAt: Date | null;
  /** Promised delivery date and time; null when none was entered. */
  dueAt: Date | null;

  /** §1 Awarded amount: agreed with the transporter at award. Bought loads only. */
  awardedAmount: number | null;
  /** §2 Cost of a load. */
  cost: number | null;
  costSource: 'own_fleet_fixed' | 'invoice' | 'awarded' | null;
  /** Freight invoice for the load, where one exists. */
  invoice: { amount: number; date: string } | null;
  /** Payments recorded against the load. */
  payments: { amount: number; date: string; type: 'advance' | 'balance' }[];
  /** Approved accessorial charges on the load. */
  charges: { loading: number; unloading: number; detention: number };
  /** Debit back to the transporter for shortage and damage. */
  creditsRecovered: number;

  /** Hours at the unloading point beyond the customer's free hours (0 when within). Null when
   *  the load has no unloading gate times. */
  detentionHours: number | null;
  hasClaim: boolean;
  claimValue: number;
  /** An ops-tagged external cause (weather, road closure, strike) on the load. */
  externalDelay: boolean;
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export function sum<T>(rows: readonly T[], pick: (row: T) => number | null): number {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

/** part ÷ whole × 100, or null when there is no whole. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? round((part / whole) * 100, 1) : null;
}

export function ratio(part: number, whole: number, places = 2): number | null {
  return whole > 0 ? round(part / whole, places) : null;
}

/** The value p % of the values stay within (nearest rank), or null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** The middle value — the mean of the two middle ones for an even count. */
export function middle(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Spread {
  median: number | null;
  p75: number | null;
  p90: number | null;
  worst: number | null;
  count: number;
}

export function spreadOf(values: readonly number[], places = 1): Spread {
  const at = (value: number | null) => (value === null ? null : round(value, places));
  return {
    median: at(middle(values)),
    p75: at(percentile(values, 75)),
    p90: at(percentile(values, 90)),
    worst: at(values.length ? Math.max(...values) : null),
    count: values.length,
  };
}

/** §1 Change vs previous period. Amounts and counts: % change. Percentages: difference in points. */
export function changeOf(
  current: number | null,
  previous: number | null,
  kind: 'relative' | 'points',
): number | null {
  if (current === null || previous === null) return null;
  if (kind === 'points') return round(current - previous, 1);
  return previous !== 0 ? round(((current - previous) / previous) * 100, 1) : null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// ─── Weight and cost (§1, §2) ────────────────────────────────────────────────

/** Loads with an E-LR weight — the only ones tonne figures may add up. */
export function weighed(facts: readonly LoadFact[]): LoadFact[] {
  return facts.filter((fact) => fact.weight !== null);
}

export function tonnesOf(facts: readonly LoadFact[]): number {
  return round(
    sum(facts, (fact) => fact.weight),
    2,
  );
}

/** Tonnes for display: null when none of the loads has a weight yet, so it never reads as 0 t. */
export function knownTonnes(facts: readonly LoadFact[]): number | null {
  return weighed(facts).length ? tonnesOf(facts) : null;
}

export function spendOf(facts: readonly LoadFact[]): number {
  return money(sum(facts, (fact) => fact.cost));
}

/**
 * §1 Awarded amount — the agreed rate on a flat load, or rate × the tonnes agreed at award on a
 * per-tonne load. Null for own-fleet loads and loads with no agreed rate.
 */
export function awardedAmountOf(input: {
  bought: boolean;
  freightType: 'per_ton' | 'flat' | null;
  freightValue: number | null;
  plannedTonnes: number | null;
}): number | null {
  if (!input.bought || input.freightValue === null || !input.freightType) return null;
  if (input.freightType === 'flat') return money(input.freightValue);
  return input.plannedTonnes === null ? null : money(input.freightValue * input.plannedTonnes);
}

/**
 * §2 Cost of a load. Own fleet: the Fleet Analytics cost of the days the load held the truck.
 * Bought and billed: the transporter's invoice. Bought and not yet billed: the awarded amount.
 */
export function costOfLoad(input: {
  bought: boolean;
  ownFleetCost: number | null;
  invoiceAmount: number | null;
  awardedAmount: number | null;
}): { cost: number | null; source: LoadFact['costSource'] } {
  if (!input.bought) {
    return input.ownFleetCost === null
      ? { cost: null, source: null }
      : { cost: money(input.ownFleetCost), source: 'own_fleet_fixed' };
  }
  if (input.invoiceAmount !== null) return { cost: money(input.invoiceAmount), source: 'invoice' };
  if (input.awardedAmount !== null) return { cost: input.awardedAmount, source: 'awarded' };
  return { cost: null, source: null };
}

// ─── Service rules (§3, §10) ─────────────────────────────────────────────────

/** §3 On time: arrived before Due time + 4 hours. Null when the load has no due time or arrival. */
export function onTimeOf(fact: LoadFact): boolean | null {
  if (!fact.deliveredAt || !fact.dueAt) return null;
  return fleetIsOnTime(fact.deliveredAt, fact.dueAt);
}

/** §3 Days late, for late loads. */
export function daysLateOf(fact: LoadFact): number | null {
  if (onTimeOf(fact) !== false) return null;
  return round(fleetLateDays(fact.deliveredAt!, fact.dueAt!), 2);
}

export interface OnTimeStats {
  measured: number;
  onTime: number;
  late: number;
  pct: number | null;
}

/** On time % = On-time delivered ÷ Delivered, over the delivered loads that have a due time. */
export function onTimeStats(delivered: readonly LoadFact[]): OnTimeStats {
  let onTime = 0;
  let late = 0;
  for (const fact of delivered) {
    const result = onTimeOf(fact);
    if (result === true) onTime += 1;
    else if (result === false) late += 1;
  }
  return { measured: onTime + late, onTime, late, pct: share(onTime, onTime + late) };
}

/** §3 Colours for on-time %. */
export function onTimeTone(pct: number | null): 'green' | 'orange' | 'red' | null {
  if (pct === null) return null;
  if (pct >= ON_TIME_GREEN_FROM) return 'green';
  return pct >= ON_TIME_ORANGE_FROM ? 'orange' : 'red';
}

/** §9 Placed on the day: Placement time on or before the end of the Pickup date. Null when the
 *  load has no placement or pickup date. */
export function placedOnDayOf(fact: LoadFact): boolean | null {
  if (!fact.placementAt || !fact.pickupDate) return null;
  return fact.placementAt <= endOfIstDate(fact.pickupDate);
}

export function placedStats(facts: readonly LoadFact[]): {
  placed: number;
  measured: number;
  pct: number | null;
} {
  let placed = 0;
  let measured = 0;
  for (const fact of facts) {
    const result = placedOnDayOf(fact);
    if (result === null) continue;
    measured += 1;
    if (result) placed += 1;
  }
  return { placed, measured, pct: share(placed, measured) };
}

export function hoursBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to || to < from) return null;
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/** §10 Loading completed: (Loaded − Placement) within 1.5 × the plant's declared turnaround. Null
 *  when either time or the turnaround is missing. */
export function loadingWithinTurnaroundOf(fact: LoadFact): boolean | null {
  const hours = hoursBetween(fact.placementAt, fact.loadedAt);
  if (hours === null || fact.plantTurnaroundHours === null) return null;
  return hours <= LOADING_TURNAROUND_FACTOR * fact.plantTurnaroundHours;
}

/** §7 Held: detention beyond the customer's free hours. */
export function isHeld(fact: LoadFact): boolean {
  return (fact.detentionHours ?? 0) > 0;
}

/** Detention hours beyond free hours — max(Hours at the drop − Free hours, 0). */
export function detentionBeyondFree(hoursAtDrop: number | null, freeHours: number): number | null {
  return hoursAtDrop === null ? null : Math.max(0, hoursAtDrop - freeHours);
}

/** §10 Clean at the drop. */
export function isClean(fact: LoadFact): boolean {
  return !fact.hasClaim;
}

/**
 * §10 Why loads ran late — the first stage that overran on a late load. Transit needs the planned
 * distance, so a load whose only overrun was in transit falls through to the later stages.
 */
export function delayReasonOf(fact: LoadFact): DelayReason {
  if (placedOnDayOf(fact) === false) return 'vehicle_placement_delay';
  if (loadingWithinTurnaroundOf(fact) === false) return 'loading_delay_at_plant';
  if (isHeld(fact)) return 'consignee_unloading_delay';
  if (fact.externalDelay) return 'external';
  return 'unattributed';
}

export function delayOwnerOf(reason: DelayReason): DelayOwner | null {
  return DELAY_REASON_OWNER[reason];
}

// ─── Transporters (§9) ───────────────────────────────────────────────────────

export interface AwardCounts {
  won: number;
  accepted: number;
  refused: number;
  noTruck: number;
}

/** §9 Acceptance of a transporter = Loads accepted ÷ Loads won. */
export function acceptanceOf(counts: AwardCounts): number | null {
  return share(counts.accepted, counts.won);
}

export interface ScoreInput {
  onTimePct: number | null;
  delivered: number;
  claims: number;
  acceptancePct: number | null;
  /** Rate against the board, %; null when no load has a benchmark. */
  rateAgainstBoardPct: number | null;
}

export interface ScoreParts {
  onTime: number;
  clean: number;
  acceptance: number;
  rate: number;
}

/**
 * §9 Score = 40 × On-time score + 20 × Clean score + 20 × Acceptance score + 20 × Rate score, each
 * part kept between 0 and 1. Null when a part the transporter has no data for cannot be scored.
 */
export function scoreOf(input: ScoreInput): { score: number; parts: ScoreParts } | null {
  if (input.onTimePct === null || input.delivered === 0 || input.acceptancePct === null) {
    return null;
  }
  const parts: ScoreParts = {
    onTime: clamp01((input.onTimePct - SCORE_ON_TIME_FLOOR) / SCORE_ON_TIME_SPAN),
    clean: clamp01(1 - ((input.claims / input.delivered) * 100) / SCORE_CLEAN_SPAN),
    acceptance: clamp01((input.acceptancePct - SCORE_ACCEPTANCE_FLOOR) / SCORE_ACCEPTANCE_SPAN),
    rate:
      input.rateAgainstBoardPct === null
        ? SCORE_RATE_NO_BENCHMARK
        : clamp01(1 - (input.rateAgainstBoardPct + SCORE_RATE_OFFSET) / SCORE_RATE_SPAN),
  };
  const score =
    SCORE_WEIGHTS.onTime * parts.onTime +
    SCORE_WEIGHTS.clean * parts.clean +
    SCORE_WEIGHTS.acceptance * parts.acceptance +
    SCORE_WEIGHTS.rate * parts.rate;
  return { score: round(score, 1), parts };
}

/** §9 Grade: A 78+, B 62–77, C 45–61, D below 45. Fewer than 8 delivered loads: unrated (null). */
export function gradeOf(score: number | null, delivered: number): TransporterGrade | null {
  if (score === null || delivered < GRADED_MIN_DELIVERED) return null;
  if (score >= GRADE_A_FROM) return 'A';
  if (score >= GRADE_B_FROM) return 'B';
  return score >= GRADE_C_FROM ? 'C' : 'D';
}

/** §9 Rate against service colour by share of bought spend. */
export function shareBandOf(sharePct: number): 'high' | 'mid' | 'low' {
  if (sharePct > SHARE_BAND_HIGH) return 'high';
  return sharePct >= SHARE_BAND_LOW ? 'mid' : 'low';
}

export interface ConcentrationRow {
  id: string;
  name: string;
  spend: number;
  /** Running total ÷ all spend × 100. */
  cumulative: number;
}

/** §9 Carrier concentration — largest first, with the running share. */
export function concentrationOf(rows: readonly { id: string; name: string; spend: number }[]): {
  rows: ConcentrationRow[];
  topShare: (n: number) => number | null;
  largestShare: number | null;
  carriersTo80: number;
} {
  const total = sum(rows, (row) => row.spend);
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  let running = 0;
  const out = sorted.map((row) => {
    running += row.spend;
    return { ...row, spend: money(row.spend), cumulative: share(running, total) ?? 0 };
  });
  // Count of transporters before the running total passes 80 %.
  let carriersTo80 = 0;
  for (const row of out) {
    carriersTo80 += 1;
    if (row.cumulative >= 80) break;
  }
  return {
    rows: out,
    topShare: (n) =>
      share(
        sum(sorted.slice(0, n), (row) => row.spend),
        total,
      ),
    largestShare: sorted.length ? share(sorted[0].spend, total) : null,
    carriersTo80: out.length ? carriersTo80 : 0,
  };
}

/** §9 Dependency risk colour. */
export function dependencyToneOf(
  sharePct: number,
  alternatives: number,
): 'red' | 'amber' | 'green' {
  if (sharePct > DEPENDENCY_RED_SHARE && alternatives <= DEPENDENCY_RED_ALTERNATIVES) return 'red';
  if (sharePct > DEPENDENCY_AMBER_SHARE || alternatives <= DEPENDENCY_AMBER_ALTERNATIVES) {
    return 'amber';
  }
  return 'green';
}

// ─── Freight Spend (§8) ──────────────────────────────────────────────────────

/** Load weight ÷ rated capacity, %, or null without both. */
export function fillOf(fact: LoadFact): number | null {
  const rated = fact.truckType?.ratedTonnes ?? null;
  if (fact.weight === null || !rated) return null;
  return (fact.weight / rated) * 100;
}

/** §8 Median fill = middle value of (Load weight ÷ Rated capacity). */
export function medianFill(facts: readonly LoadFact[]): number | null {
  const value = middle(facts.map(fillOf).filter((fill): fill is number => fill !== null));
  return value === null ? null : round(value, 1);
}

export function fillTone(pct: number | null): 'green' | 'blue' | 'amber' | null {
  if (pct === null) return null;
  if (pct >= FILL_GREEN_FROM) return 'green';
  return pct >= FILL_BLUE_FROM ? 'blue' : 'amber';
}

// ─── Billing (§11) ───────────────────────────────────────────────────────────

/** Settled amount — what was paid for the load, once paid in full (a balance payment exists). */
export function settledAmountOf(fact: LoadFact): number | null {
  if (!fact.payments.some((payment) => payment.type === 'balance')) return null;
  return money(sum(fact.payments, (payment) => payment.amount));
}

/** Last payment date of a load paid in full. */
export function lastPaymentDateOf(fact: LoadFact): string | null {
  if (settledAmountOf(fact) === null) return null;
  return fact.payments.reduce<string | null>(
    (last, payment) => (last === null || payment.date > last ? payment.date : last),
    null,
  );
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
