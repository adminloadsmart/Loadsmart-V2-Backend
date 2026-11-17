import { ClaimRecoveryMode, InvoiceStatus, ShortfallReason } from './loadsmart.types';

/** Pure money rules for Phase 8 (delivery and money) — no DB/IO; unit-tested in billing.test.ts. */

const round2 = (value: number) => Math.round(value * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// --- Invoice builder (R02) -------------------------------------------------------------------

/** "Billing instructions applied (for example loading under ₹2,000 not billed)". */
export interface BillingInstruction {
  head: string;
  notBilledUnder: number;
}

export interface InvoiceLine {
  kind: 'freight' | 'charge';
  label: string;
  amount: number;
  /** A charge left off the bill by a billing instruction — shown, not counted. */
  notBilled?: boolean;
}

export interface GstSplit {
  reverseCharge: boolean;
  /** Two-digit state code of the shipper's GSTIN — the place of supply. */
  placeOfSupply: string;
  interState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceDraftInput {
  freight: { label: string; amount: number };
  charges: { head: string; amount: number }[];
  instructions: BillingInstruction[];
  gstPercent: number;
  reverseCharge: boolean;
  loadsmartStateCode: string;
  shipperStateCode: string;
  advanceReceived: number;
}

export interface InvoiceDraft {
  lines: InvoiceLine[];
  charges: number;
  taxable: number;
  gstPercent: number;
  gst: number;
  split: GstSplit;
  /** What the shipper pays Loadsmart: under reverse charge the GST is the shipper's to pay to
   *  the government, so it is shown but not added. */
  total: number;
  advanceReceived: number;
  balanceDue: number;
}

/** "Drafted by the system from the load, nothing typed by hand". */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  const lines: InvoiceLine[] = [
    { kind: 'freight', label: input.freight.label, amount: round2(input.freight.amount) },
  ];
  for (const charge of input.charges) {
    const rule = input.instructions.find((instruction) => instruction.head === charge.head);
    const notBilled = !!rule && charge.amount < rule.notBilledUnder;
    lines.push({
      kind: 'charge',
      label: `${charge.head.replace(/_/g, ' ')} charge`,
      amount: round2(charge.amount),
      ...(notBilled ? { notBilled: true } : {}),
    });
  }
  const billed = lines.filter((line) => !line.notBilled);
  const taxable = round2(billed.reduce((sum, line) => sum + line.amount, 0));
  const charges = round2(
    billed.filter((line) => line.kind === 'charge').reduce((sum, line) => sum + line.amount, 0),
  );
  const gst = round2((taxable * input.gstPercent) / 100);
  const interState = input.shipperStateCode !== input.loadsmartStateCode;
  const half = round2(gst / 2);
  const split: GstSplit = {
    reverseCharge: input.reverseCharge,
    placeOfSupply: input.shipperStateCode,
    interState,
    cgst: interState ? 0 : half,
    sgst: interState ? 0 : round2(gst - half),
    igst: interState ? gst : 0,
  };
  const total = input.reverseCharge ? taxable : round2(taxable + gst);
  return {
    lines,
    charges,
    taxable,
    gstPercent: input.gstPercent,
    gst,
    split,
    total,
    advanceReceived: round2(input.advanceReceived),
    balanceDue: round2(total - input.advanceReceived),
  };
}

/** "Receipt date sets the due date (receipt + credit days)". Dates are IST calendar dates. */
export function dueDateFrom(receivedOn: string, creditDays: number): string {
  const date = new Date(`${receivedOn}T00:00:00Z`);
  return new Date(date.getTime() + creditDays * DAY_MS).toISOString().slice(0, 10);
}

/** Days between two IST calendar dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** The ageing view: not due, 1–15, 16–30, 31–45, over 45 days past due. */
export const AGEING_BUCKETS = ['not_due', 'd1_15', 'd16_30', 'd31_45', 'over_45'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export function ageingBucket(dueDate: string | null, today: string): AgeingBucket {
  if (!dueDate) return 'not_due';
  const late = daysBetween(dueDate, today);
  if (late <= 0) return 'not_due';
  if (late <= 15) return 'd1_15';
  if (late <= 30) return 'd16_30';
  if (late <= 45) return 'd31_45';
  return 'over_45';
}

// --- Receipts and reconciliation (R03) -------------------------------------------------------

export interface ReconcileInput {
  balanceDue: number;
  receipts: { amount: number; tdsCut: number; shortfallReason: ShortfallReason | null }[];
  creditNotes: number;
}

export interface Reconciliation {
  status: InvoiceStatus;
  received: number;
  tds: number;
  credited: number;
  /** Positive: still short; negative: excess. */
  gap: number;
  /** A gap with no reason — Receivables follows it up. */
  followUp: boolean;
}

/** "Billed vs received; gap explained by TDS, or a reason for the shortfall. Unexplained gap
 *  keeps the invoice partly paid and creates a follow-up; excess asks the shipper which invoice
 *  it belongs to." Credit notes (agreed claims) come off what is due. */
export function reconcile(input: ReconcileInput): Reconciliation {
  const received = round2(input.receipts.reduce((sum, receipt) => sum + receipt.amount, 0));
  const tds = round2(input.receipts.reduce((sum, receipt) => sum + receipt.tdsCut, 0));
  const credited = round2(input.creditNotes);
  const gap = round2(input.balanceDue - credited - received - tds);
  const explained = input.receipts.some((receipt) => receipt.shortfallReason !== null);
  let status: InvoiceStatus;
  if (!input.receipts.length && gap > 0) status = 'issued';
  else if (gap === 0) status = 'paid';
  else if (gap < 0) status = 'excess';
  else status = explained ? 'short_paid' : 'partly_paid';
  return { status, received, tds, credited, gap, followUp: status === 'partly_paid' };
}

// --- Claims (C01) ----------------------------------------------------------------------------

/** What the agreed claim takes from the carrier and what Loadsmart absorbs. */
export function claimShares(
  agreedAmount: number,
  mode: ClaimRecoveryMode,
  carrierAmount?: number,
): { carrier: number; loadsmart: number } | { error: string } {
  if (mode === 'carrier') return { carrier: round2(agreedAmount), loadsmart: 0 };
  if (mode === 'loadsmart') return { carrier: 0, loadsmart: round2(agreedAmount) };
  if (carrierAmount === undefined || carrierAmount <= 0 || carrierAmount >= agreedAmount) {
    return { error: "A split needs the carrier's share, above zero and under the agreed amount" };
  }
  return { carrier: round2(carrierAmount), loadsmart: round2(agreedAmount - carrierAmount) };
}

// --- Original POD (Y03) and the carrier balance ----------------------------------------------

/** "Due within 15 days; then ₹100 a day off the balance" — counted from the day of delivery to
 *  the day it is received (or today while it is still out). */
export function originalPodPenalty(
  deliveredOn: string,
  receivedOrToday: string,
  dueDays: number,
  perDay: number,
): { daysLate: number; penalty: number } {
  const daysLate = Math.max(0, daysBetween(deliveredOn, receivedOrToday) - dueDays);
  return { daysLate, penalty: round2(daysLate * perDay) };
}

export interface CarrierBalanceInput {
  partnerTrip: number;
  approvedCharges: number;
  /** Only an advance actually paid. */
  advanceGross: number;
  lateOriginalPodPenalty: number;
  claimRecovery: number;
  tdsPercent: number;
}

/** "Balance + unloading-side charges − late POD penalty − any deduction from a claim", TDS on
 *  what is being paid now. The loading-side charges were paid with the advance, so all approved
 *  charges less the advance gross leaves the unloading side. */
export function carrierBalance(input: CarrierBalanceInput) {
  const gross = round2(input.partnerTrip + input.approvedCharges - input.advanceGross);
  const tds = round2((gross * input.tdsPercent) / 100);
  const deductions = round2(input.lateOriginalPodPenalty + input.claimRecovery);
  const net = round2(gross - tds - deductions);
  const lines = [
    { label: 'Carrier freight', amount: round2(input.partnerTrip) },
    { label: 'Approved charges', amount: round2(input.approvedCharges) },
    { label: 'Advance paid', amount: -round2(input.advanceGross) },
    { label: `TDS at ${input.tdsPercent}%`, amount: -tds },
    ...(input.lateOriginalPodPenalty
      ? [{ label: 'Late original POD', amount: -round2(input.lateOriginalPodPenalty) }]
      : []),
    ...(input.claimRecovery
      ? [{ label: 'Claim recovery', amount: -round2(input.claimRecovery) }]
      : []),
  ];
  return { gross, tds, deductions, net, lines };
}
