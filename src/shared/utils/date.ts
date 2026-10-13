import { z } from 'zod';

/** Postgres `date` columns round-trip as 'YYYY-MM-DD' strings, so dates stay strings end to end. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole years from a 'YYYY-MM-DD' birth date to today (UTC), or undefined for a malformed date. */
export function ageFromDateOfBirth(dateOfBirth: string): number | undefined {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const today = new Date();
  const birthdayPassed =
    today.getUTCMonth() + 1 > month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);
  return today.getUTCFullYear() - year - (birthdayPassed ? 0 : 1);
}

/** Validates a plain calendar date string ("YYYY-MM-DD"), no time component. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
