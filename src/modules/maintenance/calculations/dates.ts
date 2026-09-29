/** Calendar arithmetic on 'YYYY-MM-DD' strings (UTC-anchored, so no DST/zone drift). */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parse(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds whole months, clamping to the last day of the target month (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return format(target);
}

export function addDays(date: string, days: number): string {
  return format(new Date(parse(date).getTime() + Math.round(days) * ONE_DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / ONE_DAY_MS);
}

/** Months since year 0 — a linear x-axis for month-by-month series. */
export function monthIndex(date: string): number {
  const d = parse(date);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Inverse of monthIndex for a fractional index — the fraction becomes days into that month. */
export function fromMonthIndex(index: number): string {
  const whole = Math.floor(index);
  const start = format(new Date(Date.UTC(Math.floor(whole / 12), whole % 12, 1)));
  const daysInMonth = daysBetween(start, addMonths(start, 1));
  return addDays(start, (index - whole) * daysInMonth);
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function msToDays(ms: number): number {
  return ms / ONE_DAY_MS;
}

export function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
