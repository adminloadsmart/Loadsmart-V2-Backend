import type { PaymentHeads, PaymentMode } from '../money/money-rules';

/** The advance — "amount, UTR, account, NEFT or UPI, proof (optional)". */
export interface RecordAdvanceInput {
  /** Defaults to the advance share of the agreed freight. */
  amount?: number;
  utrReference: string;
  paymentMode: PaymentMode;
  /** The account it was paid from. */
  account: string;
  transactionId?: string;
  /** Payment advice or screenshot — uploaded for purpose loads/payment-proof. */
  proofFileKey?: string;
  paymentDate: string;
}

/** The balance (stage 12) — at least one proof: UTR, transaction ID, or advice/screenshot. A
 *  Loadsmart load's payment needs the UTR. */
export interface RecordBalanceInput {
  utrReference?: string;
  transactionId?: string;
  proofFileKey?: string;
  paymentMode?: PaymentMode;
  account?: string;
  /** The amount under each head; defaults to what is due. The deduction comes off their sum. */
  heads?: PaymentHeads;
  paymentDate: string;
}

/** Loadsmart's invoice lookup — set by the Loadsmart ops module, which owns the invoices. */
export interface LoadsmartBilling {
  balanceDueOf(tenantId: string, loadId: string): Promise<string | null>;
}
