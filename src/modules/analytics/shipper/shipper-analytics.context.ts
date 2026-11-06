import { LoadAwardOutcomeEntity } from '../../loads/entities/load-award-outcome.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import {
  ShipperAnalyticsFilters,
  ShipperAnalyticsMeta,
  ShipperFilterKey,
} from './shipper-analytics.interface';
import { ShipperAnalyticsRepository } from './shipper-analytics.repository';
import { LoadFact } from './utils/shipper-analytics.calculations';
import { UNAVAILABLE_REASONS, UnavailableKey } from './utils/shipper-analytics.constants';
import { buildLoadFacts } from './utils/shipper-analytics.facts';
import {
  inWindow,
  resolveShipperPeriod,
  ShipperPeriod,
  ShipperWindow,
} from './utils/shipper-analytics.period';

/** The loads of one period, split the way the guide counts them (§1). */
export interface PeriodSlice {
  window: ShipperWindow;
  /** Loads whose loading date falls in the period — money and volume. */
  dispatched: LoadFact[];
  /** Loads whose delivery date falls in the period — service. */
  delivered: LoadFact[];
  /** Award events recorded in the period, on the filtered loads. */
  awards: LoadAwardOutcomeEntity[];
}

export interface ShipperContext {
  filters: ShipperAnalyticsFilters;
  period: ShipperPeriod;
  current: PeriodSlice;
  previous: PeriodSlice;
  roster: TransporterEntity[];
  emptyBecause: ShipperFilterKey | null;
  /** Collects the reasons for every null figure the tab returns. */
  unavailable: Record<string, string>;
  flag: (field: string, reason: UnavailableKey) => void;
}

const lower = (value: string | null | undefined) => value?.trim().toLowerCase() ?? null;

/** Each filter as a test on a load (§6). The order is the order filters are applied in. */
const FILTER_TESTS: { key: ShipperFilterKey; test: (fact: LoadFact, value: string) => boolean }[] =
  [
    { key: 'plantId', test: (fact, value) => fact.plant?.id === value },
    { key: 'destinationCity', test: (fact, value) => lower(fact.destinationCity) === lower(value) },
    { key: 'laneKey', test: (fact, value) => fact.lane?.key === value },
    { key: 'transporterId', test: (fact, value) => fact.transporter?.id === value },
    { key: 'customerId', test: (fact, value) => fact.customer?.id === value },
    { key: 'commodityId', test: (fact, value) => fact.commodity?.id === value },
    { key: 'bodyType', test: (fact, value) => fact.truckType?.bodyType === value },
    { key: 'size', test: (fact, value) => fact.truckType?.size === value },
    { key: 'boughtAs', test: (fact, value) => fact.buyMethod === value },
    { key: 'businessUnit', test: (fact, value) => lower(fact.businessUnit) === lower(value) },
  ];

/** Applies the filter bar; when a filter leaves nothing, names it (the last one that did). */
export function applyFilters(
  facts: LoadFact[],
  filters: ShipperAnalyticsFilters,
): { facts: LoadFact[]; emptyBecause: ShipperFilterKey | null } {
  let rows = facts;
  let emptyBecause: ShipperFilterKey | null = null;
  for (const { key, test } of FILTER_TESTS) {
    const value = filters[key];
    if (!value) continue;
    const before = rows.length;
    rows = rows.filter((fact) => test(fact, value));
    if (before > 0 && rows.length === 0) emptyBecause = key;
  }
  return { facts: rows, emptyBecause };
}

function sliceOf(
  facts: LoadFact[],
  awards: LoadAwardOutcomeEntity[],
  window: ShipperWindow,
): PeriodSlice {
  const loadIds = new Set(facts.map((fact) => fact.id));
  return {
    window,
    dispatched: facts.filter((fact) => inWindow(fact.loadedAt, window)),
    delivered: facts.filter((fact) => inWindow(fact.deliveredAt, window)),
    awards: awards.filter(
      (award) => loadIds.has(award.loadId) && inWindow(award.createdAt, window),
    ),
  };
}

export async function buildShipperContext(
  repository: ShipperAnalyticsRepository,
  tenantId: string,
  filters: ShipperAnalyticsFilters,
  now = new Date(),
): Promise<ShipperContext> {
  const period = resolveShipperPeriod(filters.period, filters.from, filters.to, now);
  const [records, roster, freeHours] = await Promise.all([
    repository.listLoadRecords(tenantId, { from: period.previous.from, to: period.current.to }),
    repository.listRoster(tenantId),
    repository.findUnloadingFreeHours(tenantId),
  ]);
  const { facts, emptyBecause } = applyFilters(buildLoadFacts(records, freeHours, now), filters);

  const unavailable: Record<string, string> = {};
  return {
    filters,
    period,
    current: sliceOf(facts, records.awards, period.current),
    previous: sliceOf(facts, records.awards, period.previous),
    roster,
    emptyBecause,
    unavailable,
    flag: (field, reason) => {
      unavailable[field] = UNAVAILABLE_REASONS[reason];
    },
  };
}

export function metaOf(context: ShipperContext): ShipperAnalyticsMeta {
  const view = (window: ShipperWindow) => ({
    from: window.fromDate,
    to: window.toDate,
    days: window.days,
    label: window.label,
  });
  return {
    period: { current: view(context.period.current), previous: view(context.period.previous) },
    loadsInWindow: context.current.dispatched.length,
    unavailable: context.unavailable,
    emptyBecause: context.emptyBecause,
  };
}
