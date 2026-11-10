import { rethrow } from '../../../shared/errors';
import { round, daysBetween } from '../../maintenance/calculations/dates';
import { money } from '../../maintenance/calculations/downtime';
import {
  byMonthAndMethod,
  concentrationView,
  costed,
  executionChain,
  flagWeights,
  mainLanesOf,
  medianOnTime,
  metric,
  monthOf,
  monthPoints,
  perTonneOf,
  productMovement,
  rateServicePoints,
  settledSpendOf,
  tonnesWithFlag,
  transporterStats,
  TransporterStats,
} from './shipper-analytics.builders';
import {
  buildShipperContext,
  metaOf,
  PeriodSlice,
  ShipperContext,
} from './shipper-analytics.context';
import {
  AttentionFinding,
  LeakageRow,
  Option,
  ShipperAnalyticsBilling,
  ShipperAnalyticsFilterOptions,
  ShipperAnalyticsFilters,
  ShipperAnalyticsFreightSpend,
  ShipperAnalyticsOverview,
  ShipperAnalyticsService as ServiceTab,
  ShipperAnalyticsTransporters,
  TurnaroundView,
} from './shipper-analytics.interface';
import { ShipperAnalyticsRepository } from './shipper-analytics.repository';
import {
  daysLateOf,
  delayOwnerOf,
  delayReasonOf,
  dependencyToneOf,
  fillTone,
  groupBy,
  hoursBetween,
  isClean,
  isHeld,
  knownTonnes,
  lastPaymentDateOf,
  LoadFact,
  medianFill,
  middle,
  onTimeOf,
  onTimeStats,
  onTimeTone,
  percentile,
  placedStats,
  ratio,
  settledAmountOf,
  share,
  spendOf,
  spreadOf,
  sum,
  tonnesOf,
  weighed,
} from './utils/shipper-analytics.calculations';
import {
  ATTENTION_COMMODITY_SHARE,
  ATTENTION_DETENTION_RISE,
  ATTENTION_DETENTION_SHARE,
  ATTENTION_LATE_CITY_MIN_DELIVERIES,
  ATTENTION_LATE_CITY_POINTS,
  ATTENTION_LATE_TRANSPORTER_MIN_LOADS,
  ATTENTION_LATE_TRANSPORTER_POINTS,
  ATTENTION_LIMIT,
  ATTENTION_SPEND_VS_TONNES_POINTS,
  BUY_METHODS,
  DELAY_OWNERS,
  DelayReason,
  DEPENDENCY_MIN_LOADS,
  GRADED_MIN_DELIVERED,
  LEAKAGE_TOP,
  OVERVIEW_TRANSPORTER_MIN_LOADS,
  QUALIFIED_ON_TIME,
  SLIPPING_LANE_MIN_DELIVERIES,
  SLIPPING_LANES,
  SpendMeasure,
  TurnaroundMeasure,
} from './utils/shipper-analytics.constants';

const BUY_METHOD_LABELS = { own_fleet: 'Own fleet', contract: 'Contract', spot: 'Spot' } as const;
const HISTOGRAM_BINS = 20;

const byName = (a: Option, b: Option) => a.name.localeCompare(b.name);

function uniqueOptions(rows: (Option | null)[]): Option[] {
  const map = new Map<string, Option>();
  for (const row of rows) if (row) map.set(row.id, row);
  return [...map.values()].sort(byName);
}

/** Days from an ISO date to another. */
function isoDays(from: string, to: string): number {
  return daysBetween(from, to);
}

function histogramOf(values: number[]): TurnaroundView['histogram'] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const width = max > 0 ? max / HISTOGRAM_BINS : 1;
  const bins = Array.from({ length: HISTOGRAM_BINS }, (_, index) => ({
    from: round(index * width, 2),
    to: round((index + 1) * width, 2),
    loads: 0,
  }));
  for (const value of values) {
    bins[Math.min(HISTOGRAM_BINS - 1, Math.floor(value / width))].loads += 1;
  }
  return bins;
}

export class ShipperAnalyticsService {
  constructor(private readonly repository: ShipperAnalyticsRepository) {}

  private async context(tenantId: string, filters: ShipperAnalyticsFilters) {
    return buildShipperContext(this.repository, tenantId, filters);
  }

  // ─── §6 Filters ────────────────────────────────────────────────────────────

  /** Dropdowns list only values that have at least one load in the period. */
  async getFilters(
    tenantId: string,
    filters: Pick<ShipperAnalyticsFilters, 'period' | 'from' | 'to'>,
  ): Promise<ShipperAnalyticsFilterOptions> {
    try {
      const context = await this.context(tenantId, {
        period: filters.period,
        from: filters.from,
        to: filters.to,
      });
      const loads = [...context.current.dispatched, ...context.current.delivered];
      const sizes = new Map<string, Option & { bodyType: string }>();
      for (const fact of loads) {
        const type = fact.truckType;
        if (type?.size) {
          sizes.set(`${type.bodyType}|${type.size}`, {
            id: type.size,
            name: type.size,
            bodyType: type.bodyType,
          });
        }
      }
      return {
        plants: uniqueOptions(loads.map((fact) => fact.plant)),
        destinations: uniqueOptions(
          loads.map((fact) =>
            fact.destinationCity
              ? { id: fact.destinationCity.toLowerCase(), name: fact.destinationCity }
              : null,
          ),
        ),
        lanes: uniqueOptions(
          loads.map((fact) => (fact.lane ? { id: fact.lane.key, name: fact.lane.label } : null)),
        ),
        transporters: uniqueOptions(loads.map((fact) => fact.transporter)),
        customers: uniqueOptions(
          loads.map((fact) =>
            fact.customer ? { id: fact.customer.id, name: fact.customer.name } : null,
          ),
        ),
        commodities: uniqueOptions(loads.map((fact) => fact.commodity)),
        bodyTypes: uniqueOptions(
          loads.map((fact) =>
            fact.truckType
              ? { id: fact.truckType.bodyType, name: fact.truckType.bodyTypeLabel }
              : null,
          ),
        ),
        sizes: [...sizes.values()].sort(byName),
        boughtAs: BUY_METHODS.filter((method) =>
          loads.some((fact) => fact.buyMethod === method),
        ).map((method) => ({ id: method, name: BUY_METHOD_LABELS[method] })),
        businessUnits: uniqueOptions(
          loads.map((fact) =>
            fact.businessUnit ? { id: fact.businessUnit, name: fact.businessUnit } : null,
          ),
        ),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics filters');
    }
  }

  // ─── §7 Overview ───────────────────────────────────────────────────────────

  async getOverview(
    tenantId: string,
    filters: ShipperAnalyticsFilters,
  ): Promise<ShipperAnalyticsOverview> {
    try {
      const context = await this.context(tenantId, filters);
      const { current, previous } = context;

      const spendTile = (slice: PeriodSlice) =>
        spendOf(costed(context, slice.dispatched, 'tiles.freightSpend'));
      const tonnes = (slice: PeriodSlice) =>
        tonnesWithFlag(context, slice.dispatched, 'tiles.tonnesMoved');
      const perLoad = (slice: PeriodSlice) => {
        const rows = costed(context, slice.dispatched, 'tiles.freightPerLoad');
        return ratio(spendOf(rows), rows.length, 0);
      };
      const heldAndClaims = (slice: PeriodSlice) => ({
        held: slice.delivered.filter(isHeld).length,
        claims: slice.delivered.filter((fact) => fact.hasClaim).length,
      });
      const onTime = onTimeStats(current.delivered);
      if (onTime.measured < current.delivered.length) context.flag('tiles.onTime', 'noPromise');
      context.flag('tiles.freightPerLoad.perTonneKm', 'plannedDistance');
      flagWeights(context, current.dispatched, 'tiles.freightSpend.perTonne');
      flagWeights(context, current.dispatched, 'products');
      const currentHeld = heldAndClaims(current);
      const previousHeld = heldAndClaims(previous);

      const stats = transporterStats(context, current);
      const plotted = stats.filter(
        (row) => row.dispatched.length >= OVERVIEW_TRANSPORTER_MIN_LOADS,
      );
      context.flag('ratePerTonneKm', 'plannedDistance');
      context.flag('ratePerTonneKm.boardMedian', 'boardRates');

      const leakage = leakageOf(current.dispatched);
      return {
        meta: metaOf(context),
        tiles: {
          freightSpend: {
            ...metric(spendTile(current), spendTile(previous)),
            perTonne: perTonneOf(current.dispatched),
          },
          loadsMoved: {
            ...metric(current.delivered.length, previous.delivered.length),
            dispatched: current.dispatched.length,
          },
          tonnesMoved: {
            ...metric(tonnes(current), tonnes(previous)),
            perLoad: ratio(tonnesOf(current.dispatched), weighed(current.dispatched).length, 1),
          },
          detentionAndClaims: {
            ...metric(
              currentHeld.held + currentHeld.claims,
              previousHeld.held + previousHeld.claims,
            ),
            ...currentHeld,
          },
          onTime: {
            ...metric(onTime.pct, onTimeStats(previous.delivered).pct, 'points'),
            delivered: current.delivered.length,
          },
          freightPerLoad: { ...metric(perLoad(current), perLoad(previous)), perTonneKm: null },
        },
        attention: this.attention(context),
        products: productMovement(current.dispatched),
        spendByMonth: byMonthAndMethod(context.period.months, current.dispatched, spendOf),
        ratePerTonneKm: monthPoints(context.period.months, () => ({
          paid: null,
          boardMedian: null,
        })),
        transporters: {
          plot: rateServicePoints(context, plotted),
          concentration: concentrationView(plotted),
        },
        execution: executionChain(context, current),
        goDeeper: {
          freightSpend: spendOf(current.dispatched),
          carriersUsed: stats.filter((row) => row.dispatched.length > 0).length,
          onTimePct: onTime.pct,
          leakage: leakage.value,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics overview');
    }
  }

  /** §7 What needs attention — up to 5 findings, rupee findings first (largest first). */
  private attention(context: ShipperContext): AttentionFinding[] {
    const { current, previous } = context;
    const findings: AttentionFinding[] = [];
    const ids = (facts: LoadFact[]) => facts.map((fact) => fact.id);

    // 1. Spend rising faster than tonnage.
    const spend = spendOf(current.dispatched);
    const previousSpend = spendOf(previous.dispatched);
    const tonnes = tonnesOf(current.dispatched);
    const previousTonnes = tonnesOf(previous.dispatched);
    if (previousSpend > 0 && previousTonnes > 0) {
      const spendChange = ((spend - previousSpend) / previousSpend) * 100;
      const tonnesChange = ((tonnes - previousTonnes) / previousTonnes) * 100;
      if (spendChange - tonnesChange > ATTENTION_SPEND_VS_TONNES_POINTS) {
        findings.push({
          rule: 'spend_vs_tonnage',
          subject: null,
          amount: money(spend - previousSpend * (1 + tonnesChange / 100)),
          unit: 'rupees',
          detail: { spendChange: round(spendChange, 1), tonnesChange: round(tonnesChange, 1) },
          loadIds: ids(current.dispatched),
        });
      }
    }

    // 2. A lane much dearer than the rest — needs ₹ per tonne-km.
    context.flag('attention.dear_lane', 'plannedDistance');

    // 3. A transporter consistently late.
    const delivered = current.delivered.filter((fact) => fact.bought);
    const overall = onTimeStats(delivered).pct;
    const candidates = [...groupBy(delivered, (fact) => fact.transporter?.id ?? null).values()]
      .filter((facts) => facts.length >= ATTENTION_LATE_TRANSPORTER_MIN_LOADS)
      .map((facts) => ({ facts, pct: onTimeStats(facts).pct }))
      .filter((row): row is { facts: LoadFact[]; pct: number } => row.pct !== null)
      .sort((a, b) => a.pct - b.pct);
    const latest = candidates[0];
    if (latest && overall !== null && overall - latest.pct > ATTENTION_LATE_TRANSPORTER_POINTS) {
      findings.push({
        rule: 'late_transporter',
        subject: latest.facts[0].transporter!.name,
        amount: latest.facts.length,
        unit: 'loads',
        detail: { onTimePct: latest.pct, overallPct: overall },
        loadIds: ids(latest.facts),
      });
    }

    // 4. One commodity carrying the bill.
    const byCommodity = [
      ...groupBy(current.dispatched, (fact) => fact.commodity?.id ?? null).values(),
    ]
      .map((facts) => ({ facts, spend: spendOf(facts) }))
      .sort((a, b) => b.spend - a.spend);
    const top = byCommodity[0];
    const topShare = top ? share(top.spend, spend) : null;
    if (top && topShare !== null && topShare > ATTENTION_COMMODITY_SHARE) {
      findings.push({
        rule: 'commodity_share',
        subject: top.facts[0].commodity!.name,
        amount: top.spend,
        unit: 'rupees',
        detail: { sharePct: topShare },
        loadIds: ids(top.facts),
      });
    }

    // 5. Detention running high.
    const held = current.delivered.filter(isHeld);
    const heldShare = share(held.length, current.delivered.length);
    const previousShare = share(
      previous.delivered.filter(isHeld).length,
      previous.delivered.length,
    );
    if (
      heldShare !== null &&
      (heldShare > ATTENTION_DETENTION_SHARE ||
        (previousShare !== null &&
          previousShare > 0 &&
          heldShare > previousShare * (1 + ATTENTION_DETENTION_RISE)))
    ) {
      findings.push({
        rule: 'detention',
        subject: null,
        amount: round(
          sum(held, (fact) => fact.detentionHours),
          1,
        ),
        unit: 'hours',
        detail: { heldPct: heldShare, previousHeldPct: previousShare },
        loadIds: ids(held),
      });
    }

    // 6. A destination late more than others.
    const allOnTime = onTimeStats(current.delivered).pct;
    const cities = [
      ...groupBy(current.delivered, (fact) => fact.destinationCity?.toLowerCase() ?? null).values(),
    ]
      .filter((facts) => facts.length >= ATTENTION_LATE_CITY_MIN_DELIVERIES)
      .map((facts) => ({ facts, stats: onTimeStats(facts) }))
      .filter((row) => row.stats.pct !== null)
      .sort((a, b) => a.stats.pct! - b.stats.pct!);
    const worstCity = cities[0];
    if (
      worstCity &&
      allOnTime !== null &&
      allOnTime - worstCity.stats.pct! > ATTENTION_LATE_CITY_POINTS
    ) {
      findings.push({
        rule: 'late_destination',
        subject: worstCity.facts[0].destinationCity,
        amount: worstCity.stats.late,
        unit: 'loads',
        detail: { onTimePct: worstCity.stats.pct, overallPct: allOnTime },
        loadIds: ids(worstCity.facts.filter((fact) => onTimeOf(fact) === false)),
      });
    }

    const rupees = findings
      .filter((row) => row.unit === 'rupees')
      .sort((a, b) => b.amount - a.amount);
    const others = findings
      .filter((row) => row.unit !== 'rupees')
      .sort((a, b) => b.amount - a.amount);
    return [...rupees, ...others].slice(0, ATTENTION_LIMIT);
  }

  // ─── §8 Freight Spend ──────────────────────────────────────────────────────

  async getFreightSpend(
    tenantId: string,
    filters: ShipperAnalyticsFilters,
    measure: SpendMeasure,
  ): Promise<ShipperAnalyticsFreightSpend> {
    try {
      const context = await this.context(tenantId, filters);
      const { current, previous } = context;
      const measureOf = (facts: LoadFact[]) =>
        measure === 'spend' ? spendOf(facts) : measure === 'loads' ? facts.length : tonnesOf(facts);

      const spend = (slice: PeriodSlice) =>
        spendOf(costed(context, slice.dispatched, 'tiles.freightSpend'));
      const tonnes = (slice: PeriodSlice) =>
        tonnesWithFlag(context, slice.dispatched, 'tiles.tonnesMoved');
      const perLoad = (slice: PeriodSlice) => {
        const rows = costed(context, slice.dispatched, 'tiles.freightPerLoad');
        return ratio(spendOf(rows), rows.length, 0);
      };
      const ownShare = (slice: PeriodSlice) =>
        share(slice.dispatched.filter((fact) => !fact.bought).length, slice.dispatched.length);
      context.flag('perTonneKm', 'plannedDistance');
      for (const field of ['tiles.freightPerTonne', 'products', 'customers', 'truckTypes']) {
        flagWeights(context, current.dispatched, field);
      }

      const own = current.dispatched.filter((fact) => !fact.bought);
      const months = groupBy(current.dispatched, (fact) =>
        fact.loadedAt ? monthOf(fact.loadedAt) : null,
      );

      return {
        meta: metaOf(context),
        measure,
        tiles: {
          freightSpend: metric(spend(current), spend(previous)),
          loadsDispatched: {
            ...metric(current.dispatched.length, previous.dispatched.length),
            destinations: new Set(
              current.dispatched.map((fact) => fact.destinationCity?.toLowerCase()).filter(Boolean),
            ).size,
          },
          tonnesMoved: {
            ...metric(tonnes(current), tonnes(previous)),
            perLoad: ratio(tonnesOf(current.dispatched), weighed(current.dispatched).length, 1),
          },
          freightPerLoad: { ...metric(perLoad(current), perLoad(previous)), perTonneKm: null },
          freightPerTonne: {
            ...metric(perTonneOf(current.dispatched), perTonneOf(previous.dispatched)),
            medianFillPct: medianFill(current.dispatched),
          },
          ownFleetShare: {
            ...metric(ownShare(current), ownShare(previous), 'points'),
            ownFleetCost: spendOf(own),
          },
        },
        byMonth: byMonthAndMethod(context.period.months, current.dispatched, measureOf),
        monthRows: monthPoints(context.period.months, (month) => {
          const rows = months.get(month) ?? [];
          return { loads: rows.length, spend: spendOf(rows), perTonneKm: null };
        }),
        products: productMovement(current.dispatched),
        customers: [...groupBy(current.dispatched, (fact) => fact.customer?.id ?? null).values()]
          .map((facts) => {
            const customer = facts[0].customer!;
            const delivered = current.delivered.filter((fact) => fact.customer?.id === customer.id);
            const onTime = onTimeStats(delivered).pct;
            return {
              id: customer.id,
              name: customer.name,
              city: customer.city,
              loads: facts.length,
              tonnes: knownTonnes(facts),
              spend: spendOf(facts),
              perTonneKm: null,
              vsOverall: null,
              onTimePct: onTime,
              onTimeTone: onTimeTone(onTime),
              detained: facts.filter(isHeld).length,
            };
          })
          .sort((a, b) => b.spend - a.spend),
        commodities: [...groupBy(current.dispatched, (fact) => fact.commodity?.id ?? null).values()]
          .map((facts) => ({
            id: facts[0].commodity!.id,
            name: facts[0].commodity!.name,
            value: measureOf(facts),
          }))
          .sort((a, b) => b.value - a.value),
        businessUnits: [...groupBy(current.dispatched, (fact) => fact.businessUnit).entries()]
          .map(([name, facts]) => ({ name, value: measureOf(facts), loads: facts.length }))
          .sort((a, b) => b.value - a.value),
        truckTypes: [...groupBy(current.dispatched, (fact) => fact.truckType?.key ?? null).values()]
          .map((facts) => {
            const type = facts[0].truckType!;
            const filled = medianFill(facts);
            return {
              key: type.key,
              bodyType: type.bodyTypeLabel,
              size: type.size,
              ratedTonnes: type.ratedTonnes,
              loads: facts.length,
              perTonneKm: null,
              filledPct: filled,
              filledTone: fillTone(filled),
            };
          })
          .sort((a, b) => b.loads - a.loads),
        ownTrucks: own.length ? this.ownTrucks(context, current) : null,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics freight spend');
    }
  }

  /** §8 Own trucks against the market. */
  private ownTrucks(
    context: ShipperContext,
    slice: PeriodSlice,
  ): ShipperAnalyticsFreightSpend['ownTrucks'] {
    context.flag('ownTrucks', 'ownFleetRunningCost');
    flagWeights(
      context,
      slice.dispatched.filter((fact) => !fact.bought),
      'ownTrucks',
    );
    const own = slice.dispatched.filter((fact) => !fact.bought);
    const bought = slice.dispatched.filter((fact) => fact.bought);
    const ownLanes = new Set(own.map((fact) => fact.lane?.key).filter(Boolean));
    const sharedLanes = new Set(
      bought.map((fact) => fact.lane?.key).filter((key) => key && ownLanes.has(key)),
    );
    return {
      ownPerTonneKm: null,
      boughtPerTonneKm: null,
      sameLanes: { own: null, bought: null, lanes: sharedLanes.size },
      ownFilledPct: medianFill(own),
      trucks: [...groupBy(own, (fact) => fact.vehicle?.id ?? null).values()]
        .map((facts) => ({
          id: facts[0].vehicle!.id,
          number: facts[0].vehicle!.name,
          loads: facts.length,
          tonnes: knownTonnes(facts),
          km: null,
          filledPct: medianFill(facts),
          tripCost: spendOf(facts),
          perTonneKm: null,
        }))
        .sort((a, b) => b.loads - a.loads),
    };
  }

  // ─── §9 Transporters ───────────────────────────────────────────────────────

  async getTransporters(
    tenantId: string,
    filters: ShipperAnalyticsFilters,
  ): Promise<ShipperAnalyticsTransporters> {
    try {
      const context = await this.context(tenantId, filters);
      const { current, previous } = context;
      const stats = transporterStats(context, current);
      const previousStats = transporterStats(context, previous);
      const used = (rows: TransporterStats[]) => rows.filter((row) => row.dispatched.length > 0);
      const average = (values: (number | null)[]) => {
        const known = values.filter((value): value is number => value !== null);
        return known.length ? round(sum(known, (value) => value) / known.length, 1) : null;
      };
      const claims = (slice: PeriodSlice) =>
        slice.delivered.filter((fact) => fact.bought && fact.hasClaim);

      const graded = stats.filter((row) => row.grade !== null);
      const points = rateServicePoints(
        context,
        stats.filter((row) => row.delivered.length >= GRADED_MIN_DELIVERED),
      );

      return {
        meta: metaOf(context),
        tiles: {
          carriersUsed: {
            ...metric(used(stats).length, used(previousStats).length),
            roster: context.roster.length,
          },
          topFiveShare: metric(
            concentrationView(stats).topFiveShare,
            concentrationView(previousStats).topFiveShare,
            'points',
          ),
          tenderAcceptance: metric(
            average(stats.map((row) => row.acceptancePct)),
            average(previousStats.map((row) => row.acceptancePct)),
            'points',
          ),
          placedOnDay: metric(
            average(stats.map((row) => row.placedPct)),
            average(previousStats.map((row) => row.placedPct)),
            'points',
          ),
          gradeA: {
            value: graded.filter((row) => row.grade === 'A').length,
            graded: graded.length,
            gradeD: graded.filter((row) => row.grade === 'D').length,
            unrated: stats.length - graded.length,
          },
          claims: {
            ...metric(claims(current).length, claims(previous).length),
            claimValue: money(sum(claims(current), (fact) => fact.claimValue)),
          },
        },
        rateVsService: { points, dividers: { perTonneKm: null, onTimePct: medianOnTime(points) } },
        carriers: stats
          .map((row) => ({
            id: row.id,
            name: row.name,
            loads: row.dispatched.length,
            tonnes: row.tonnes,
            spend: row.spend,
            perTonneKm: null,
            onTimePct: row.onTimePct,
            onTimeTone: onTimeTone(row.onTimePct),
            placedPct: row.placedPct,
            claims: row.claims > 0 ? row.claims : row.held,
            claimsAreHeld: row.claims === 0,
            ...mainLanesOf(row),
            delivered: row.delivered.length,
            acceptancePct: row.acceptancePct,
            score: row.score,
            grade: row.grade,
          }))
          .sort((a, b) => b.spend - a.spend),
        concentration: concentrationView(stats),
        dependency: this.dependency(context, stats),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics transporters');
    }
  }

  /** §9 Dependency risk — lanes with 5+ loads, the share held by the largest transporter. */
  private dependency(
    context: ShipperContext,
    stats: TransporterStats[],
  ): ShipperAnalyticsTransporters['dependency'] {
    const onTimeById = new Map(stats.map((row) => [row.id, row.onTimePct]));
    const bought = context.current.dispatched.filter((fact) => fact.bought && fact.transporter);
    const normal = (state: string | null | undefined) => state?.trim().toLowerCase() ?? null;

    return [...groupBy(bought, (fact) => fact.lane?.key ?? null).values()]
      .filter((facts) => facts.length >= DEPENDENCY_MIN_LOADS)
      .map((facts) => {
        const laneSpend = settledSpendOf(facts);
        const byTransporter = [...groupBy(facts, (fact) => fact.transporter!.id).values()]
          .map((rows) => ({ transporter: rows[0].transporter!, spend: settledSpendOf(rows) }))
          .sort((a, b) => b.spend - a.spend);
        const largest = byTransporter[0];
        const sharePct = share(largest.spend, laneSpend) ?? 0;
        const state = normal(facts[0].destinationState);
        const alternatives = context.roster.filter(
          (transporter) =>
            transporter.id !== largest.transporter.id &&
            state !== null &&
            transporter.lanes.some((lane) => normal(lane.destinationState) === state) &&
            (onTimeById.get(transporter.id) ?? 0) >= QUALIFIED_ON_TIME,
        ).length;
        return {
          laneKey: facts[0].lane!.key,
          lane: facts[0].lane!.label,
          spend: laneSpend,
          sharePct,
          largest: largest.transporter,
          alternatives,
          tone: dependencyToneOf(sharePct, alternatives),
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }

  // ─── §10 Service ───────────────────────────────────────────────────────────

  async getService(tenantId: string, filters: ShipperAnalyticsFilters): Promise<ServiceTab> {
    try {
      const context = await this.context(tenantId, filters);
      const { current, previous } = context;

      const onTime = (slice: PeriodSlice) => onTimeStats(slice.delivered).pct;
      const clean = (slice: PeriodSlice) =>
        share(slice.delivered.filter(isClean).length, slice.delivered.length);
      const daysLate = (slice: PeriodSlice) =>
        slice.delivered.map(daysLateOf).filter((days): days is number => days !== null);
      const medianLate = (slice: PeriodSlice) => {
        const value = middle(daysLate(slice));
        return value === null ? null : round(value, 1);
      };
      const detained = (slice: PeriodSlice) => slice.dispatched.filter(isHeld);
      const claimValue = (slice: PeriodSlice) =>
        money(sum(slice.delivered, (fact) => fact.claimValue));
      if (onTimeStats(current.delivered).measured < current.delivered.length)
        context.flag('tiles.onTime', 'noPromise');

      return {
        meta: metaOf(context),
        tiles: {
          onTime: {
            ...metric(onTime(current), onTime(previous), 'points'),
            delivered: current.delivered.length,
          },
          placedOnDay: metric(
            placedStats(current.dispatched).pct,
            placedStats(previous.dispatched).pct,
            'points',
          ),
          cleanAtDrop: {
            ...metric(clean(current), clean(previous), 'points'),
            withClaims: current.delivered.filter((fact) => fact.hasClaim).length,
          },
          medianDaysLate: {
            ...metric(medianLate(current), medianLate(previous)),
            p90: percentile(daysLate(current), 90),
          },
          loadsDetained: {
            ...metric(detained(current).length, detained(previous).length),
            hoursBeyondFree: round(
              sum(detained(current), (fact) => fact.detentionHours),
              1,
            ),
          },
          claimValue: metric(claimValue(current), claimValue(previous)),
        },
        execution: executionChain(context, current),
        lateReasons: this.lateReasons(context, current),
        turnaround: this.turnaround(context, current),
        onTimeByMonth: this.onTimeByMonth(context),
        periodAverage: onTime(current),
        lanes: this.slippingLanes(current),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics service');
    }
  }

  /** §10 Why loads ran late — by reason, largest first, with the running total and owners. */
  private lateReasons(context: ShipperContext, slice: PeriodSlice): ServiceTab['lateReasons'] {
    context.flag('lateReasons.transporter_transit_delay', 'plannedDistance');
    context.flag('lateReasons.documentation', 'documentationDelays');
    const late = slice.delivered.filter((fact) => onTimeOf(fact) === false);
    const counts = new Map<DelayReason, number>();
    for (const fact of late) {
      const reason = delayReasonOf(fact);
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const attributed = [...counts.entries()]
      .filter(([reason]) => reason !== 'unattributed')
      .sort((a, b) => b[1] - a[1]);
    let running = 0;
    return {
      rows: attributed.map(([reason, loads]) => {
        running += loads;
        return {
          reason,
          owner: delayOwnerOf(reason),
          loads,
          cumulative: share(running, late.length) ?? 0,
        };
      }),
      owners: DELAY_OWNERS.map((owner) => {
        const loads = sum(
          attributed.filter(([reason]) => delayOwnerOf(reason) === owner),
          ([, count]) => count,
        );
        return { owner, loads, share: share(loads, late.length) };
      }),
      unattributed: counts.get('unattributed') ?? 0,
      lateLoads: late.length,
    };
  }

  /** §10 Turnaround, as a spread — the six measures. */
  private turnaround(context: ShipperContext, slice: PeriodSlice): TurnaroundView[] {
    const hours = (values: (number | null)[]) =>
      values.filter((value): value is number => value !== null);
    const measures: { measure: TurnaroundMeasure; unit: 'hours' | 'days'; values: number[] }[] = [
      {
        measure: 'order_to_placement',
        unit: 'hours',
        values: hours(slice.dispatched.map((fact) => hoursBetween(fact.orderAt, fact.placementAt))),
      },
      {
        measure: 'loading',
        unit: 'hours',
        values: hours(
          slice.dispatched.map((fact) => hoursBetween(fact.placementAt, fact.loadedAt)),
        ),
      },
      {
        measure: 'transit',
        unit: 'days',
        values: hours(
          slice.delivered.map((fact) => hoursBetween(fact.loadedAt, fact.deliveredAt)),
        ).map((value) => value / 24),
      },
      {
        measure: 'detention_at_drop',
        unit: 'hours',
        values: hours(slice.dispatched.map((fact) => fact.detentionHours)),
      },
      {
        measure: 'pod_turnaround',
        unit: 'hours',
        values: hours(slice.delivered.map((fact) => hoursBetween(fact.deliveredAt, fact.podAt))),
      },
      {
        measure: 'invoice_to_settled',
        unit: 'days',
        values: slice.delivered
          .map((fact) => {
            const paid = lastPaymentDateOf(fact);
            return fact.invoice && paid ? isoDays(fact.invoice.date, paid) : null;
          })
          .filter((value): value is number => value !== null && value >= 0),
      },
    ];
    context.flag('turnaround.invoice_to_settled', 'freightPayable');
    return measures.map(({ measure, unit, values }) => {
      const spread = spreadOf(values, 1);
      return {
        measure,
        unit,
        histogram: histogramOf(values),
        median: spread.median,
        p75: spread.p75,
        p90: spread.p90,
        worst: spread.worst,
        measured: spread.count,
      };
    });
  }

  /** §10 On-time by delivery month and placed-on-the-day by loading month. */
  private onTimeByMonth(context: ShipperContext): ServiceTab['onTimeByMonth'] {
    const delivered = groupBy(context.current.delivered, (fact) =>
      fact.deliveredAt ? monthOf(fact.deliveredAt) : null,
    );
    const dispatched = groupBy(context.current.dispatched, (fact) =>
      fact.loadedAt ? monthOf(fact.loadedAt) : null,
    );
    return monthPoints(context.period.months, (month) => ({
      deliveredOnTime: onTimeStats(delivered.get(month) ?? []).pct,
      placedOnDay: placedStats(dispatched.get(month) ?? []).pct,
    }));
  }

  /** §10 The 8 lanes with the lowest on-time, of lanes with 6+ deliveries. */
  private slippingLanes(slice: PeriodSlice): ServiceTab['lanes'] {
    return [...groupBy(slice.delivered, (fact) => fact.lane?.key ?? null).values()]
      .filter((facts) => facts.length >= SLIPPING_LANE_MIN_DELIVERIES)
      .map((facts) => {
        const onTime = onTimeStats(facts).pct;
        const lateDays = facts.map(daysLateOf).filter((days): days is number => days !== null);
        const median = middle(lateDays);
        const carriers = [
          ...groupBy(
            facts.filter((fact) => fact.bought),
            (fact) => fact.transporter?.id ?? null,
          ).values(),
        ]
          .map((rows) => ({ name: rows[0].transporter!.name, spend: spendOf(rows) }))
          .sort((a, b) => b.spend - a.spend);
        return {
          laneKey: facts[0].lane!.key,
          lane: facts[0].lane!.label,
          delivered: facts.length,
          onTimePct: onTime,
          onTimeTone: onTimeTone(onTime),
          medianDaysLate: median === null ? null : round(median, 1),
          topCarrier: carriers[0]?.name ?? null,
        };
      })
      .filter((row) => row.onTimePct !== null)
      .sort((a, b) => a.onTimePct! - b.onTimePct!)
      .slice(0, SLIPPING_LANES);
  }

  // ─── §11 Billing ───────────────────────────────────────────────────────────

  async getBilling(
    tenantId: string,
    filters: ShipperAnalyticsFilters,
  ): Promise<ShipperAnalyticsBilling> {
    try {
      const context = await this.context(tenantId, filters);
      const { current, previous } = context;
      for (const field of [
        'tiles.avoidable',
        'tiles.invoicesDisputed',
        'bridge.rate_variance',
        'bridge.unreconciled',
        'bridgeStats.recoverable',
        'funnel.invoiced',
        'disputes',
        'leakage.charge_head.rate_variance',
        'leakage.charge_head.sundry',
      ]) {
        context.flag(field, 'freightPayable');
      }
      context.flag('bridge.other_accessorials', 'accessorialHeads');

      const bought = (slice: PeriodSlice) => slice.dispatched.filter((fact) => fact.bought);
      const awarded = (slice: PeriodSlice) =>
        money(sum(bought(slice), (fact) => fact.awardedAmount));
      const paid = (slice: PeriodSlice) =>
        bought(slice).filter((fact) => settledAmountOf(fact) !== null);
      const settled = (slice: PeriodSlice) => settledSpendOf(paid(slice));
      const leak = leakageOf(current.dispatched);
      const previousLeak = leakageOf(previous.dispatched);

      const paidNow = paid(current);
      const invoiceDays = paidNow
        .map((fact) => {
          const last = lastPaymentDateOf(fact);
          return fact.invoice && last ? isoDays(fact.invoice.date, last) : null;
        })
        .filter((value): value is number => value !== null && value >= 0);
      const detention = money(sum(paidNow, (fact) => fact.charges.detention));
      const accessorials = money(
        sum(paidNow, (fact) => fact.charges.loading + fact.charges.unloading),
      );
      const credits = money(sum(paidNow, (fact) => fact.creditsRecovered));

      return {
        meta: metaOf(context),
        tiles: {
          awardedFreight: {
            ...metric(awarded(current), awarded(previous)),
            boughtLoads: bought(current).length,
          },
          settledFreight: {
            ...metric(settled(current), settled(previous)),
            paidLoads: paidNow.length,
          },
          leakage: {
            ...metric(leak.value, previousLeak.value),
            pctOfAwarded: leak.pct,
            pctChange:
              leak.pct === null || previousLeak.pct === null
                ? null
                : round(leak.pct - previousLeak.pct, 1),
          },
          avoidable: { value: null },
          invoicesDisputed: { pct: null, disputed: null, open: null },
          invoiceToSettled: {
            medianDays: middle(invoiceDays),
            p90Days: percentile(invoiceDays, 90),
          },
        },
        bridge: [
          {
            key: 'awarded',
            value: money(sum(paidNow, (fact) => fact.awardedAmount)),
            loads: paidNow.length,
          },
          { key: 'rate_variance', value: null, loads: 0 },
          {
            key: 'detention',
            value: detention,
            loads: paidNow.filter((fact) => fact.charges.detention > 0).length,
          },
          {
            key: 'other_accessorials',
            value: accessorials,
            loads: paidNow.filter((fact) => fact.charges.loading + fact.charges.unloading > 0)
              .length,
          },
          {
            key: 'credits_recovered',
            value: -credits,
            loads: paidNow.filter((fact) => fact.creditsRecovered > 0).length,
          },
          { key: 'unreconciled', value: null, loads: 0 },
          { key: 'settled', value: settledSpendOf(paidNow), loads: paidNow.length },
        ],
        bridgeStats: { leakage: leak.value, pctOfAwarded: leak.pct, recoverable: null },
        funnel: {
          awarded: { value: awarded(current), loads: bought(current).length },
          invoiced: { value: null, invoices: null },
          settled: { value: settled(current), loads: paidNow.length },
          awardedToInvoicedMismatch: null,
          invoicedToSettledMismatch: null,
          averageDisputeDays: null,
        },
        leakage: {
          charge_head: [
            { id: 'rate_variance', label: 'Rate variance', value: null, loads: 0 },
            {
              id: 'detention',
              label: 'Detention',
              value: detention,
              loads: paidNow.filter((fact) => fact.charges.detention > 0).length,
            },
            {
              id: 'loading_unloading_fov',
              label: 'Loading / unloading / FOV',
              value: accessorials,
              loads: paidNow.filter((fact) => fact.charges.loading + fact.charges.unloading > 0)
                .length,
            },
            { id: 'sundry', label: 'Sundry charges', value: null, loads: 0 },
            {
              id: 'credits_recovered',
              label: 'Credits recovered',
              value: -credits,
              loads: paidNow.filter((fact) => fact.creditsRecovered > 0).length,
            },
          ],
          transporter: leakageBy(paidNow, (fact) => fact.transporter),
          lane: leakageBy(paidNow, (fact) =>
            fact.lane ? { id: fact.lane.key, name: fact.lane.label } : null,
          ),
          customer: leakageBy(paidNow, (fact) => fact.customer),
        },
        disputes: { heads: null, disputedShare: null, medianDays: null, p90Days: null },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics billing');
    }
  }
}

/**
 * §11 Leakage = Settled freight − Awarded freight, over the bought loads that have been settled
 * (a load not yet paid in full has no settled amount to compare).
 */
function leakageOf(dispatched: LoadFact[]): { value: number | null; pct: number | null } {
  const rows = dispatched.filter(
    (fact) => fact.bought && fact.awardedAmount !== null && settledAmountOf(fact) !== null,
  );
  if (rows.length === 0) return { value: null, pct: null };
  const awarded = sum(rows, (fact) => fact.awardedAmount);
  const value = money(sum(rows, settledAmountOf) - awarded);
  return { value, pct: share(value, awarded) };
}

/** §11 Where the leakage sits, by transporter, lane or customer — top 14. */
function leakageBy(paid: LoadFact[], keyOf: (fact: LoadFact) => Option | null): LeakageRow[] {
  const rows = paid.filter((fact) => fact.awardedAmount !== null);
  return [...groupBy(rows, (fact) => keyOf(fact)?.id ?? null).values()]
    .map((facts) => {
      const ref = keyOf(facts[0])!;
      return {
        id: ref.id,
        label: ref.name,
        value: money(sum(facts, settledAmountOf) - sum(facts, (fact) => fact.awardedAmount)),
        loads: facts.length,
      };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, LEAKAGE_TOP);
}
