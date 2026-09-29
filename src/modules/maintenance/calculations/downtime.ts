import { DAYS_PER_MONTH } from '../maintenance.constants';
import { FixedCostSource } from '../maintenance.types';
import { msToDays, round } from './dates';

/**
 * Days a job kept the truck off the road inside [from, to]: the overlap of
 * [openedAt, closedAt ?? now] with the window, so a breakdown straddling the window boundary only
 * counts the part inside it.
 */
export function downtimeDaysInWindow(
  openedAt: Date,
  closedAt: Date | null,
  window: { from: Date; to: Date },
  now: Date,
): number {
  const end = Math.min((closedAt ?? now).getTime(), window.to.getTime(), now.getTime());
  const start = Math.max(openedAt.getTime(), window.from.getTime());
  return end > start ? msToDays(end - start) : 0;
}

/** Whole job duration — [openedAt, closedAt ?? now] — unrounded, for cost arithmetic. */
export function elapsedDays(openedAt: Date, closedAt: Date | null, now: Date): number {
  return Math.max(0, msToDays((closedAt ?? now).getTime() - openedAt.getTime()));
}

/** elapsedDays rounded for display on a single row. */
export function jobDays(openedAt: Date, closedAt: Date | null, now: Date): number {
  return round(elapsedDays(openedAt, closedAt, now), 1);
}

/**
 * The cost that runs whether or not the truck moves, per day:
 *   fixed_cost_monthly / 30   (EMI + insurance + salaries etc., as entered on the vehicle)
 *   else emi_amount / 30      (the only fixed cost most vehicles carry today)
 *   else 0                    (and reported as source `none` so the screen can say so)
 */
export function dailyFixedCost(
  fixedCostMonthly: string | null | undefined,
  emiAmount: string | null | undefined,
): { perDay: number; source: FixedCostSource } {
  if (fixedCostMonthly !== null && fixedCostMonthly !== undefined) {
    return { perDay: Number(fixedCostMonthly) / DAYS_PER_MONTH, source: 'fixed' };
  }
  if (emiAmount !== null && emiAmount !== undefined) {
    return { perDay: Number(emiAmount) / DAYS_PER_MONTH, source: 'emi' };
  }
  return { perDay: 0, source: 'none' };
}

export function money(value: number): number {
  return round(value, 2);
}
