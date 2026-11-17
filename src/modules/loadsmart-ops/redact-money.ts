// Money a team may not see, stripped wherever it is nested (sourcing entities sit inside load
// detail, partner bids and payments hang off them). Mirrors console-rules.ts moneyVisibility:
// carrier money is for Placement, Tracking, Payables and Super Admin; shipper money for Placement,
// Receivables, Approval and Super Admin. A team that sees only one side can't work out the margin,
// because the other side's price is gone.
export const CARRIER_MONEY_KEYS = new Set([
  'partnerRate',
  'partnerTargetRate',
  'partnerBids',
  'partnerPayments',
  'bankAccountNumber',
  'bankIfsc',
  'upiId',
]);
export const SHIPPER_MONEY_KEYS = new Set(['shipperPrice', 'invoice', 'creditNotes']);

export function redactMoney<T>(value: T, see: { shipper: boolean; carrier: boolean }): T {
  const hidden = new Set<string>([
    ...(see.carrier ? [] : CARRIER_MONEY_KEYS),
    ...(see.shipper ? [] : SHIPPER_MONEY_KEYS),
  ]);
  return (hidden.size ? strip(value, hidden) : value) as T;
}

function strip(value: unknown, hidden: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, hidden));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!hidden.has(key)) out[key] = strip(child, hidden);
  }
  return out;
}
