import { startOfIstDay, endOfIstDay, startOfIstDate, endOfIstDate } from './ist-time';

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
