/**
 * Pure money rules of a Loadsmart load — no DB/IO. Margin is the share of the shipper's price
 * Loadsmart keeps: margin% = (price − partner rate) / price. All rates are in the load's own
 * freight basis (per trip, or per tonne × the load's tonnes).
 */

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The rate partners see on the load board — the shipper's target with the margin taken out.
 *  Null when the shipper asked for quotes (no target). */
export function partnerTargetRate(targetRate: number | null, marginPercent: number): number | null {
  if (!targetRate) return null;
  return Math.floor(targetRate * (1 - marginPercent / 100));
}

/** Loadsmart's price to the shipper for a partner's rate at this margin, rounded up to the rupee. */
export function shipperPriceFor(partnerRate: number, marginPercent: number): number {
  return Math.ceil(partnerRate / (1 - marginPercent / 100));
}

export function effectiveMarginPercent(shipperPrice: number, partnerRate: number): number {
  return round2(((shipperPrice - partnerRate) / shipperPrice) * 100);
}

/** Why the bid can't be sent at this margin, or null. Under the minimum it needs a note of the
 *  negotiation with the shipper; at or below zero it can't be sent at all. */
export function marginError(
  marginPercent: number,
  minimumPercent: number,
  negotiationNote: string | undefined,
): string | null {
  if (marginPercent <= 0) return 'Loadsmart would make no margin on this bid';
  if (marginPercent < minimumPercent && !negotiationNote?.trim()) {
    return `The margin is ${marginPercent}% — under ${minimumPercent}%. Negotiate with the shipper and add a note before sending`;
  }
  return null;
}

/** A rate in the load's basis as a trip amount. */
export function tripAmount(
  rate: number,
  freightType: 'per_ton' | 'flat' | null,
  tonnes: number,
): number {
  return round2(freightType === 'per_ton' ? rate * tonnes : rate);
}

export interface PartnerPaymentAmounts {
  gross: number;
  tds: number;
  deductions: number;
  net: number;
}

/** "The team lead releases the advance, less TDS." */
export function partnerAdvance(
  partnerTrip: number,
  advancePercent: number,
  tdsPercent: number,
): PartnerPaymentAmounts {
  const gross = round2((partnerTrip * advancePercent) / 100);
  const tds = round2((gross * tdsPercent) / 100);
  return { gross, tds, deductions: 0, net: round2(gross - tds) };
}

/** "Payables pays the partner's balance, less any deductions": the partner's trip amount plus
 *  approved charges, less the advance already paid (gross), the claim recovered from the partner,
 *  and TDS on what is being paid now. */
export function partnerBalance(input: {
  partnerTrip: number;
  approvedCharges: number;
  advanceGross: number;
  claimRecovery: number;
  tdsPercent: number;
}): PartnerPaymentAmounts {
  const gross = round2(input.partnerTrip + input.approvedCharges - input.advanceGross);
  const tds = round2((gross * input.tdsPercent) / 100);
  const deductions = round2(input.claimRecovery);
  return { gross, tds, deductions, net: round2(gross - tds - deductions) };
}

export interface InvoiceAmounts {
  freight: number;
  charges: number;
  claimCredit: number;
  taxable: number;
  gstPercent: number;
  gst: number;
  total: number;
  advanceReceived: number;
  balanceDue: number;
}

/** The shipper's invoice: freight at Loadsmart's price plus approved charges, less the settled
 *  claim credited to the shipper, plus GST; the advance already paid comes off the balance due. */
export function invoiceAmounts(input: {
  freight: number;
  approvedCharges: number;
  claimCredit: number;
  gstPercent: number;
  advanceReceived: number;
}): InvoiceAmounts {
  const taxable = round2(input.freight + input.approvedCharges - input.claimCredit);
  const gst = round2((taxable * input.gstPercent) / 100);
  const total = round2(taxable + gst);
  return {
    freight: round2(input.freight),
    charges: round2(input.approvedCharges),
    claimCredit: round2(input.claimCredit),
    taxable,
    gstPercent: input.gstPercent,
    gst,
    total,
    advanceReceived: round2(input.advanceReceived),
    balanceDue: round2(total - input.advanceReceived),
  };
}

/** What the Approval team has to check before posting the load on the board. */
export function missingSourcingFields(
  posting: {
    customerId: string | null;
    rate: string | null;
    pickupAt: Date | null;
    weightTonnes: string | null;
    truckTypeId: string | null;
    pickupAddress: { latitude: number | null; longitude: number | null } | null;
    dropAddress: { latitude: number | null; longitude: number | null } | null;
  } | null,
): string[] {
  if (!posting) return ['posting'];
  const missing: string[] = [];
  if (!posting.customerId) missing.push('customer');
  if (!posting.rate) missing.push('target rate');
  if (!posting.pickupAt) missing.push('pickup time');
  if (!posting.weightTonnes) missing.push('weight');
  if (!posting.truckTypeId) missing.push('truck type');
  if (posting.pickupAddress?.latitude == null) missing.push('pickup location pin');
  if (posting.dropAddress?.latitude == null) missing.push('drop location pin');
  return missing;
}
