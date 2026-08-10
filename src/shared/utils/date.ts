import { z } from 'zod';

/** Postgres `date` columns round-trip as 'YYYY-MM-DD' strings, so dates stay strings end to end. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Validates a plain calendar date string ("YYYY-MM-DD"), no time component. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
