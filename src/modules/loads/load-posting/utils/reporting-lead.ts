/** "Truck reporting time: at least 30 minutes after posting" — the minimum lead comes from Super
 *  Admin → Settings (minReportingLeadMinutes), never a constant. */

const MINUTE_MS = 60_000;
const HALF_HOUR_MS = 30 * MINUTE_MS;

export function formatLead(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Why this reporting time is too soon, or null when it's far enough ahead. */
export function reportingLeadError(
  reportingAt: Date,
  now: Date,
  leadMinutes: number,
): string | null {
  if (reportingAt.getTime() >= now.getTime() + leadMinutes * MINUTE_MS) return null;
  return `Truck reporting time must be at least ${formatLead(leadMinutes)} from now`;
}

/** The earliest reporting time the form should offer: the minimum lead from `now`, rounded up to
 *  the next half hour (PL-01 note 5). */
export function earliestReporting(now: Date, leadMinutes: number): Date {
  const earliest = now.getTime() + leadMinutes * MINUTE_MS;
  return new Date(Math.ceil(earliest / HALF_HOUR_MS) * HALF_HOUR_MS);
}
