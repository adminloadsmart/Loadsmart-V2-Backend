import {
  startOfIstDay,
  endOfIstDay,
  startOfIstDate,
  endOfIstDate,
  toIstDateString,
} from './ist-time';

// Quick date-range filter shared by list endpoints across modules (organizations today, staff /
// referral codes / dashboards potentially later). Single source of truth reused by each module's
// zod validator and query builder so the value set can't drift — same pattern as
// ORGANIZATION_STATUSES in organization.entity.ts.
export const DATE_FILTERS = ['today', 'last7days', 'last15days', 'last30days', 'custom'] as const;
export type DateFilter = (typeof DATE_FILTERS)[number];

export interface DateRange {
  from: Date;
  to: Date;
}

// Resolves a DateFilter (+ from/to, only read when filter === 'custom') into a concrete Date range
// a repository can pass straight into TypeORM's Between(). All boundaries are IST calendar days
// (see ist-time.ts) — this project is India-based, so "today" means IST's today, not the server
// process's ambient/unset timezone and not UTC. Returns undefined when filter is omitted (no date
// filtering requested) or 'custom' is missing from/to (defensive fallback — the zod layer is
// expected to already require both in that case).
export function resolveDateRange(
  filter?: DateFilter,
  from?: string,
  to?: string,
): DateRange | undefined {
  if (!filter) return undefined;

  const now = new Date();

  switch (filter) {
    case 'today':
      return { from: startOfIstDay(now), to: endOfIstDay(now) };
    case 'last7days':
      return { from: startOfIstDay(now, 6), to: endOfIstDay(now) };
    case 'last15days':
      return { from: startOfIstDay(now, 14), to: endOfIstDay(now) };
    case 'last30days':
      return { from: startOfIstDay(now, 29), to: endOfIstDay(now) };
    case 'custom':
      if (!from || !to) return undefined;
      return { from: startOfIstDate(from), to: endOfIstDate(to) };
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Every IST calendar date (YYYY-MM-DD, inclusive) `range` spans, in order — for zero-filling a
// per-day series so a chart shows one point per day even when some days have no rows, not just
// the days a GROUP BY query happened to return (see dashboards.service.ts's getLoadsSummary, the
// first caller). Safe to step in flat 24h increments because IST has a fixed +05:30 offset with
// no DST (see ist-time.ts's header comment) — every IST calendar day is exactly 24h wide in
// UTC-instant terms too, so this can't skip or repeat a day the way naive Date#setDate(+1)
// arithmetic can across a DST boundary in other timezones.
export function enumerateIstDates(range: DateRange): string[] {
  const dates: string[] = [];
  for (let t = range.from.getTime(); t <= range.to.getTime(); t += ONE_DAY_MS) {
    dates.push(toIstDateString(new Date(t)));
  }
  return dates;
}
