/** Loadsmart ops value sets — const tuples shared by entities, validators and services. */

/** A Loadsmart sourcing per market load: Approval → load board → Placement sends one bid →
 *  the shipper accepts (won) or another bid wins (lost); cancelled when Approval rejects it. */
export const SOURCING_STATUSES = [
  'pending_approval',
  'posted',
  'bid_sent',
  'won',
  'lost',
  'cancelled',
] as const;
export type SourcingStatus = (typeof SOURCING_STATUSES)[number];

/** Loadsmart's partners — fleet owners and brokers. */
export const PARTNER_TYPES = ['fleet_owner', 'broker'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_STATUSES = ['active', 'inactive'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_BID_STATUSES = ['received', 'sent', 'won', 'lost'] as const;
export type PartnerBidStatus = (typeof PARTNER_BID_STATUSES)[number];

export const CHARGE_TYPES = ['loading', 'unloading', 'detention'] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export { CHARGE_STATUSES } from '../loads/money/charge.types';
export type { ChargeStatus } from '../loads/money/charge.types';

export { CHARGE_RAISERS } from '../loads/money/charge.types';
export type { ChargeRaiser } from '../loads/money/charge.types';

export const PARTNER_PAYMENT_TYPES = ['advance', 'balance'] as const;
export type PartnerPaymentType = (typeof PARTNER_PAYMENT_TYPES)[number];

/** Money going out to a carrier: Tracking raises the advance, Super Admin approves (or holds or
 *  rejects) it, Payables records the UTR — paid. */
export const PARTNER_PAYMENT_STATUSES = [
  'raised',
  'approved',
  'on_hold',
  'rejected',
  'paid',
] as const;
export type PartnerPaymentStatus = (typeof PARTNER_PAYMENT_STATUSES)[number];

/** Charge heads that go with the advance (loading side); the rest go with the balance. */
export const LOADING_SIDE_HEADS = ['loading', 'loading_detention', 'tarpaulin', 'overloading'];

/** Loadsmart-wide numbering (invoices, credit notes) — one sequence across every shipper. */
export const LOADSMART_SEQUENCE_SCOPE = '00000000-0000-0000-0000-000000000000';

/** The office the original POD is couriered to. */
export const ORIGINAL_POD_OFFICE = 'Mohali';

export const CLAIM_STATUSES = ['open', 'settled'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Who bears the agreed claim: the carrier's balance in full, split, or Loadsmart absorbs it. */
export const CLAIM_RECOVERY_MODES = ['carrier', 'split', 'loadsmart'] as const;
export type ClaimRecoveryMode = (typeof CLAIM_RECOVERY_MODES)[number];

// --- Receivables ---

/** How Loadsmart's invoice reached the shipper. Nothing is sent from here — the team records it. */
export const INVOICE_SEND_CHANNELS = ['app', 'email', 'whatsapp', 'courier'] as const;
export type InvoiceSendChannel = (typeof INVOICE_SEND_CHANNELS)[number];

/** `short_paid`: less came in, with the gap explained; `excess`: more came in than was due. */
export const INVOICE_STATUSES = ['issued', 'partly_paid', 'paid', 'short_paid', 'excess'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** The shipper's side is done once the invoice is in one of these. */
export const INVOICE_SETTLED_STATUSES: readonly InvoiceStatus[] = ['paid', 'short_paid', 'excess'];

/** R03 "paid through". */
export const RECEIPT_CHANNELS = ['company_account', 'individual', 'pdc'] as const;
export type ReceiptChannel = (typeof RECEIPT_CHANNELS)[number];

/** R03: why less came in than was billed (beyond the TDS the shipper cut). */
export const SHORTFALL_REASONS = [
  'rounded_down',
  'damage_or_shortage_deduction',
  'late_delivery_penalty',
  'tds_not_confirmed',
  'other',
] as const;
export type ShortfallReason = (typeof SHORTFALL_REASONS)[number];

/** Money in the bank that matches no customer or invoice. */
export const UNCLAIMED_STATUSES = ['unclaimed', 'under_review', 'matched', 'refunded'] as const;
export type UnclaimedStatus = (typeof UNCLAIMED_STATUSES)[number];

export const PAYMENT_MODES_IN = ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash'] as const;
export type PaymentModeIn = (typeof PAYMENT_MODES_IN)[number];

/** Does the shipper bill on the POD image, or need the physical original first? */
export const POD_TYPES = ['image', 'original'] as const;
export type PodType = (typeof POD_TYPES)[number];

// --- Payables: original POD tracker (Y03) ---

export const ORIGINAL_POD_STATUSES = [
  'yet_to_dispatch',
  'dispatched',
  'received_filed',
  'not_contactable',
  'not_traceable',
] as const;
export type OriginalPodStatus = (typeof ORIGINAL_POD_STATUSES)[number];

export const RATING_SUBJECTS = ['shipper', 'partner'] as const;
export type RatingSubject = (typeof RATING_SUBJECTS)[number];

/** A Loadsmart shipper payment's check — now `verified` when recorded; `pending` and `rejected`
 *  remain for payments recorded before that. */
export const PAYMENT_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type PaymentVerificationStatus = (typeof PAYMENT_VERIFICATION_STATUSES)[number];

// A shipper without commercial terms of its own (ls_commercial_terms) gets Super Admin →
// Settings' central margin and default carrier advance (settings/settings.types.ts).
/** "If the margin is under 6%, the team negotiates with the shipper before sending." */
export const MIN_MARGIN_PERCENT = 6;
/** "Calls partners who haven't bid in 5 minutes." */
export const PARTNER_CALL_AFTER_MS = 5 * 60 * 1000;
/** TDS on a partner's payments when the partner master has no rate of its own (194C, 1%). */
export const DEFAULT_TDS_PERCENT = 1;

/** How a shipper asked Loadsmart to post a load for them. */
export const ON_BEHALF_CHANNELS = ['whatsapp', 'call', 'email'] as const;
export type OnBehalfChannel = (typeof ON_BEHALF_CHANNELS)[number];
