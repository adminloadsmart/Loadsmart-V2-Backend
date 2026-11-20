import { LoadStatus } from '../utils/loads.types';
import { TRANSPORTER_CHARGE_HEADS, TransporterChargeHead } from './charge.types';

/**
 * Pure money rules of an own-transporter or indent load — the shipper pays its own transporter
 * outside Loadsmart and records it here. No DB/IO; unit-tested in money-rules.test.ts.
 */

/** How a payment was made. */
export const PAYMENT_MODES = ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** The heads a balance payment is recorded under: the freight still due, then each charge head. */
export const PAYMENT_HEADS = ['freight', ...TRANSPORTER_CHARGE_HEADS] as const;
export type PaymentHead = (typeof PAYMENT_HEADS)[number];
export type PaymentHeads = Partial<Record<PaymentHead, number>>;

/** Charges are added from Loaded (the papers are in) until the balance is paid. */
export const CHARGE_STAGES: readonly LoadStatus[] = [
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
  'delivered_ok',
  'delivered_with_issues',
  'invoice_generated',
];

/** Trucks can be cancelled from Truck assigned until Loaded. */
export const TRUCK_CANCELLABLE_STAGES: readonly LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
];

/** "Cancel should exist up to the point the truck is loaded." */
export const LOAD_CANCELLABLE_STAGES: readonly LoadStatus[] = [
  'created',
  'bids_received',
  ...TRUCK_CANCELLABLE_STAGES,
];

/** "You can withdraw the load until you accept the load memo." */
export const LOAD_WITHDRAWABLE_STAGES: readonly LoadStatus[] = ['created', 'bids_received'];

/** The reason code a withdrawal is recorded under when none is picked. */
export const WITHDRAW_DEFAULT_REASON = 'shipper_cancelled';

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface MoneyLoad {
  freightType: 'per_ton' | 'flat' | null;
  freightValue: string | null;
  plannedCapacityTonnes: string;
  deliveryIssueDeductionAmount: string | null;
}

export interface MoneyPayment {
  paymentType: 'advance' | 'balance';
  amount: string;
}

export interface MoneyCharge {
  chargeType: string;
  amount: string;
  status: string;
}

export interface MoneySummary {
  /** The trip's freight — per tonne × planned tonnes, or flat. Null until a rate is agreed. */
  freightTotal: number | null;
  advancePaid: number;
  /** Approved charges, by head, and in total. */
  charges: Partial<Record<TransporterChargeHead, number>>;
  chargesTotal: number;
  /** Taken off for an issue on the POD. */
  deduction: number;
  /** What the balance should be: freight − advance + charges − deduction, by head. */
  balanceHeads: PaymentHeads;
  balanceDue: number;
  balancePaid: number | null;
}

export function freightTotalOf(load: MoneyLoad): number | null {
  if (!load.freightValue) return null;
  const rate = Number(load.freightValue);
  return round2(load.freightType === 'per_ton' ? rate * Number(load.plannedCapacityTonnes) : rate);
}

/** Where the load's money stands. Only approved charges count. */
export function moneySummary(
  load: MoneyLoad,
  payments: MoneyPayment[],
  charges: MoneyCharge[],
): MoneySummary {
  const freightTotal = freightTotalOf(load);
  const advancePaid = round2(
    payments
      .filter((payment) => payment.paymentType === 'advance')
      .reduce((sum, payment) => sum + Number(payment.amount), 0),
  );
  const byHead: Partial<Record<TransporterChargeHead, number>> = {};
  for (const charge of charges) {
    if (charge.status !== 'approved') continue;
    if (!(TRANSPORTER_CHARGE_HEADS as readonly string[]).includes(charge.chargeType)) continue;
    const head = charge.chargeType as TransporterChargeHead;
    byHead[head] = round2((byHead[head] ?? 0) + Number(charge.amount));
  }
  const chargesTotal = round2(Object.values(byHead).reduce((sum, amount) => sum + amount, 0));
  const deduction = round2(Number(load.deliveryIssueDeductionAmount ?? 0));
  const balanceHeads: PaymentHeads = {
    freight: round2(Math.max(0, (freightTotal ?? 0) - advancePaid)),
    ...byHead,
  };
  const balance = payments.find((payment) => payment.paymentType === 'balance');
  return {
    freightTotal,
    advancePaid,
    charges: byHead,
    chargesTotal,
    deduction,
    balanceHeads,
    balanceDue: round2(sumHeads(balanceHeads) - deduction),
    balancePaid: balance ? Number(balance.amount) : null,
  };
}

export function sumHeads(heads: PaymentHeads): number {
  return round2(Object.values(heads).reduce((sum, amount) => sum + (amount ?? 0), 0));
}

/** "Proof is mandatory": a UTR, a transaction ID, or a payment advice / screenshot. */
export function paymentProofError(proof: {
  utrReference?: string | null;
  transactionId?: string | null;
  proofFileKey?: string | null;
}): string | null {
  return proof.utrReference?.trim() || proof.transactionId?.trim() || proof.proofFileKey
    ? null
    : 'Add the payment proof — a UTR, a transaction ID, or the payment advice or screenshot';
}
