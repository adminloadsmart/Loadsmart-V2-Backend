import { round } from '../../maintenance/calculations/dates';
import { money } from '../../maintenance/calculations/downtime';
import { toIstDateString } from '../../../shared/utils/ist-time';
import { PeriodSlice, ShipperContext } from './shipper-analytics.context';
import {
  ConcentrationView,
  ExecutionStage,
  Metric,
  MonthPoint,
  ProductRow,
  RateServicePoint,
} from './shipper-analytics.interface';
import {
  acceptanceOf,
  AwardCounts,
  changeOf,
  concentrationOf,
  gradeOf,
  groupBy,
  hoursBetween,
  loadingWithinTurnaroundOf,
  LoadFact,
  middle,
  onTimeStats,
  onTimeTone,
  placedStats,
  ratio,
  scoreOf,
  settledAmountOf,
  share,
  shareBandOf,
  spendOf,
  knownTonnes,
  sum,
  tonnesOf,
  weighed,
} from './utils/shipper-analytics.calculations';
import {
  BUY_METHODS,
  BuyMethod,
  MAIN_LANES,
  PRODUCT_MOVEMENT_TOP,
  TOP_CARRIERS,
  TransporterGrade,
} from './utils/shipper-analytics.constants';
import { ShipperMonth } from './utils/shipper-analytics.period';

// Figures more than one tab shows, built once from the context. Each says which section of the
// Metric Guide it implements.

export function metric(
  current: number | null,
  previous: number | null,
  kind: 'relative' | 'points' = 'relative',
): Metric {
  return { value: current, previous, change: changeOf(current, previous, kind), changeKind: kind };
}

export function monthOf(at: Date): string {
  return toIstDateString(at).slice(0, 7);
}

export function monthPoints<T>(
  months: ShipperMonth[],
  build: (month: string) => T,
): (MonthPoint & T)[] {
  return months.map((month) => ({ month: month.month, label: month.label, ...build(month.month) }));
}

// ─── Money and volume ────────────────────────────────────────────────────────

/** Dispatched loads that carry a cost (§2) — loads with none are named under missingCost. */
export function costed(context: ShipperContext, facts: LoadFact[], field: string): LoadFact[] {
  const withCost = facts.filter((fact) => fact.cost !== null);
  if (withCost.length < facts.length) context.flag(`${field}.missingCost`, 'missingCost');
  if (facts.some((fact) => fact.costSource === 'own_fleet_fixed')) {
    context.flag(`${field}.ownFleet`, 'ownFleetRunningCost');
  }
  return withCost;
}

/** Tonnes of the loads that have an E-LR weight (null when none has); flags the rest. */
export function tonnesWithFlag(
  context: ShipperContext,
  facts: LoadFact[],
  field: string,
): number | null {
  if (facts.some((fact) => fact.weight === null))
    context.flag(`${field}.missingWeight`, 'missingWeight');
  return knownTonnes(facts);
}

/** Freight ÷ Tonnes over the loads that have both a cost and a weight. */
export function perTonneOf(facts: LoadFact[]): number | null {
  const rows = weighed(facts).filter((fact) => fact.cost !== null);
  return ratio(spendOf(rows), tonnesOf(rows), 2);
}

/** §7 Monthly spend by buy method (or loads / tonnes, for the Freight Spend toggle). */
export function byMonthAndMethod(
  months: ShipperMonth[],
  dispatched: LoadFact[],
  value: (rows: LoadFact[]) => number,
): (MonthPoint & Record<BuyMethod, number>)[] {
  const byMonth = groupBy(dispatched, (fact) => (fact.loadedAt ? monthOf(fact.loadedAt) : null));
  return monthPoints(months, (month) => {
    const rows = byMonth.get(month) ?? [];
    return Object.fromEntries(
      BUY_METHODS.map((method) => [
        method,
        value(rows.filter((fact) => fact.buyMethod === method)),
      ]),
    ) as Record<BuyMethod, number>;
  });
}

/** §7 Product movement: by commodity, top 8 by tonnes, with the top-2 share. */
export function productMovement(dispatched: LoadFact[]): {
  rows: ProductRow[];
  topTwoShare: number | null;
} {
  const allTonnes = tonnesOf(dispatched);
  const rows = [...groupBy(dispatched, (fact) => fact.commodity?.id ?? null).values()]
    .map((facts): ProductRow => {
      const tonnes = knownTonnes(facts);
      return {
        commodityId: facts[0].commodity!.id,
        name: facts[0].commodity!.name,
        tonnes,
        share: tonnes === null ? null : share(tonnes, allTonnes),
        loads: facts.length,
        freight: spendOf(facts),
        perTonne: perTonneOf(facts),
        tonnesPerLoad: tonnes === null ? null : ratio(tonnes, weighed(facts).length, 1),
      };
    })
    // Top 8 by tonnes; commodities with no weight yet sort last, by loads.
    .sort((a, b) => (b.tonnes ?? -1) - (a.tonnes ?? -1) || b.loads - a.loads);
  const topTwo = sum(rows.slice(0, 2), (row) => row.tonnes);
  return { rows: rows.slice(0, PRODUCT_MOVEMENT_TOP), topTwoShare: share(topTwo, allTonnes) };
}

// ─── Execution chain (§10) ───────────────────────────────────────────────────

function stage(
  key: ExecutionStage['key'],
  numerator: number | null,
  denominator: number | null,
): ExecutionStage {
  // A stage no load reached has nothing to measure — null, not "0 of 0".
  if (numerator === null || !denominator) {
    return { key, pct: null, numerator: null, denominator: null, tone: null };
  }
  const pct = share(numerator, denominator);
  return { key, pct, numerator, denominator, tone: onTimeTone(pct) };
}

export function awardCounts(awards: PeriodSlice['awards']): AwardCounts {
  const count = (outcome: string) => awards.filter((award) => award.outcome === outcome).length;
  return {
    won: count('won'),
    accepted: count('accepted'),
    refused: count('refused'),
    noTruck: count('no_truck'),
  };
}

/** §10 The execution chain — five stages, each on its own timestamps, not cumulative. */
export function executionChain(context: ShipperContext, slice: PeriodSlice): ExecutionStage[] {
  // Tender accepted = Bought loads ÷ (Bought loads + Awards refused or with no truck).
  const counts = awardCounts(slice.awards);
  const bought = slice.dispatched.filter((fact) => fact.bought).length;
  const hasAwards = counts.won + counts.accepted + counts.refused + counts.noTruck > 0;
  if (!hasAwards) context.flag('execution.tender_accepted', 'awardHistory');
  const declined = counts.refused + counts.noTruck;

  // Loading completed — only over loads whose plant declares a turnaround.
  const timed = slice.dispatched.filter(
    (fact) => hoursBetween(fact.placementAt, fact.loadedAt) !== null,
  );
  const measured = timed.filter((fact) => loadingWithinTurnaroundOf(fact) !== null);
  if (measured.length < timed.length)
    context.flag('execution.loading_completed', 'missingTurnaround');
  const withinTurnaround = measured.filter((fact) => loadingWithinTurnaroundOf(fact)).length;

  context.flag('execution.transit', 'plannedDistance');
  const placed = placedStats(slice.dispatched);
  const onTime = onTimeStats(slice.delivered);
  if (onTime.measured < slice.delivered.length)
    context.flag('execution.delivered_on_time', 'noPromise');

  return [
    stage('tender_accepted', hasAwards ? bought : null, hasAwards ? bought + declined : null),
    stage('vehicle_placed', placed.placed, placed.measured),
    stage('loading_completed', measured.length ? withinTurnaround : null, measured.length || null),
    stage('transit', null, null),
    stage('delivered_on_time', onTime.onTime, onTime.measured),
  ];
}

// ─── Transporters (§9) ───────────────────────────────────────────────────────

export interface TransporterStats {
  id: string;
  name: string;
  dispatched: LoadFact[];
  delivered: LoadFact[];
  /** §9 Transporter spend uses the settled amount of each load. */
  spend: number;
  tonnes: number | null;
  onTimePct: number | null;
  placedPct: number | null;
  claims: number;
  held: number;
  lanes: { label: string; loads: number }[];
  acceptancePct: number | null;
  score: number | null;
  grade: TransporterGrade | null;
}

export function settledSpendOf(facts: LoadFact[]): number {
  return money(sum(facts, settledAmountOf));
}

/** Per-transporter figures over bought loads (§9 "Who is moving the freight"). */
export function transporterStats(context: ShipperContext, slice: PeriodSlice): TransporterStats[] {
  const dispatchedBy = groupBy(
    slice.dispatched.filter((fact) => fact.bought),
    (fact) => fact.transporter?.id ?? null,
  );
  const deliveredBy = groupBy(
    slice.delivered.filter((fact) => fact.bought),
    (fact) => fact.transporter?.id ?? null,
  );
  const awardsBy = groupBy(slice.awards, (award) => award.transporterId);
  const ids = new Set([...dispatchedBy.keys(), ...deliveredBy.keys()]);
  if (slice.awards.length === 0) context.flag('transporters.acceptance', 'awardHistory');
  context.flag('transporters.rateScore', 'boardRates');
  context.flag('transporters.spend', 'settledOnly');

  return [...ids].map((id): TransporterStats => {
    const dispatched = dispatchedBy.get(id) ?? [];
    const delivered = deliveredBy.get(id) ?? [];
    const name = (dispatched[0] ?? delivered[0]).transporter!.name;
    const onTime = onTimeStats(delivered);
    const claims = delivered.filter((fact) => fact.hasClaim).length;
    const lanes = [...groupBy(dispatched, (fact) => fact.lane?.label ?? null).entries()]
      .map(([label, rows]) => ({ label, loads: rows.length }))
      .sort((a, b) => b.loads - a.loads);
    const awards = awardsBy.get(id) ?? [];
    const acceptancePct = awards.length ? acceptanceOf(awardCounts(awards)) : null;
    // §9 Rate score is 0.5 when no load has a benchmark — no board rates are recorded yet.
    const scored = scoreOf({
      onTimePct: onTime.pct,
      delivered: delivered.length,
      claims,
      acceptancePct,
      rateAgainstBoardPct: null,
    });
    return {
      id,
      name,
      dispatched,
      delivered,
      spend: settledSpendOf(dispatched),
      tonnes: knownTonnes(dispatched),
      onTimePct: onTime.pct,
      placedPct: placedStats(dispatched).pct,
      claims,
      held: delivered.filter((fact) => (fact.detentionHours ?? 0) > 0).length,
      lanes,
      acceptancePct,
      score: scored?.score ?? null,
      grade: gradeOf(scored?.score ?? null, delivered.length),
    };
  });
}

export function concentrationView(stats: TransporterStats[]): ConcentrationView {
  const result = concentrationOf(stats.map(({ id, name, spend }) => ({ id, name, spend })));
  return {
    rows: result.rows.filter((row) => row.spend > 0),
    topFiveShare: result.topShare(TOP_CARRIERS),
    largestShare: result.largestShare,
    carriersTo80: result.carriersTo80,
  };
}

/** §9 Rate against service — one bubble per transporter; x needs the planned distance. */
export function rateServicePoints(
  context: ShipperContext,
  stats: TransporterStats[],
): RateServicePoint[] {
  context.flag('rateVsService.perTonneKm', 'plannedDistance');
  const total = sum(stats, (row) => row.spend);
  return stats.map((row) => {
    const sharePct = share(row.spend, total);
    return {
      id: row.id,
      name: row.name,
      perTonneKm: null,
      onTimePct: row.onTimePct,
      spend: row.spend,
      sharePct,
      band: shareBandOf(sharePct ?? 0),
    };
  });
}

export function medianOnTime(points: { onTimePct: number | null }[]): number | null {
  const value = middle(
    points.map((point) => point.onTimePct).filter((pct): pct is number => pct !== null),
  );
  return value === null ? null : round(value, 1);
}

export function mainLanesOf(stats: TransporterStats): { mainLanes: string[]; moreLanes: number } {
  return {
    mainLanes: stats.lanes.slice(0, MAIN_LANES).map((lane) => lane.label),
    moreLanes: Math.max(0, stats.lanes.length - MAIN_LANES),
  };
}
