// Loadsmart's margin on a load or a shipper's terms — visible to Placement and the Admin team only
// (16 Nov notes §7: "margin figures stay Admin/Placement-only"); every other ops team gets the
// same payload with these keys removed, wherever they're nested (sourcing entities sit inside
// queue rows, load detail, terms...).
export const MARGIN_KEYS = new Set(['marginPercent', 'effectiveMarginPercent']);

export function redactMargin<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!MARGIN_KEYS.has(key)) out[key] = strip(child);
  }
  return out;
}
