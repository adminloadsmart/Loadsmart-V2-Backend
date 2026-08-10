// Asia/Kolkata never observes DST and has had a fixed +05:30 UTC offset since 1947 — no IANA
// timezone database or Intl lookup needed. Centralized here so every IST-calendar calculation in
// the codebase (date filters, daily cutoffs, reports, ...) shares one reviewed implementation
// instead of each call site re-deriving its own +/- 5.5h math (an easy place to get the sign
// backwards). Kept private — callers only ever see the named boundary functions below.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Start of the IST calendar day `date` falls on, `daysAgo` days back (0 = today), as a UTC instant.
// Shifting `date` forward by the IST offset and reading its UTC getters yields the correct IST
// calendar date regardless of what timezone the process itself is running in.
export function startOfIstDay(date: Date, daysAgo = 0): Date {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const ms = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo);
  return new Date(ms - IST_OFFSET_MS);
}

// End of that same IST calendar day (23:59:59.999 IST), as a UTC instant.
export function endOfIstDay(date: Date, daysAgo = 0): Date {
  return new Date(startOfIstDay(date, daysAgo).getTime() + (24 * 60 * 60 * 1000 - 1));
}

// Start of the IST calendar day named by an ISO date string (YYYY-MM-DD), as a UTC instant.
export function startOfIstDate(isoDate: string): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - IST_OFFSET_MS);
}

// End of the IST calendar day named by an ISO date string (YYYY-MM-DD), as a UTC instant.
export function endOfIstDate(isoDate: string): Date {
  return new Date(Date.parse(`${isoDate}T23:59:59.999Z`) - IST_OFFSET_MS);
}
