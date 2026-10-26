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

export const CHARGE_STATUSES = ['raised', 'approved', 'rejected'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Who raised the charge — Loadsmart's team, or the shipper entering the amount agreed with the
 *  receiver at the gate (approved as it is entered). */
export const CHARGE_RAISERS = ['loadsmart', 'shipper'] as const;
export type ChargeRaiser = (typeof CHARGE_RAISERS)[number];

export const PARTNER_PAYMENT_TYPES = ['advance', 'balance'] as const;
export type PartnerPaymentType = (typeof PARTNER_PAYMENT_TYPES)[number];

export const CLAIM_STATUSES = ['open', 'settled'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const RATING_SUBJECTS = ['shipper', 'partner'] as const;
export type RatingSubject = (typeof RATING_SUBJECTS)[number];

/** A Loadsmart shipper payment's check — now `verified` when recorded; `pending` and `rejected`
 *  remain for payments recorded before that. */
export const PAYMENT_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type PaymentVerificationStatus = (typeof PAYMENT_VERIFICATION_STATUSES)[number];

/** Defaults when a shipper has no commercial terms of its own (ls_commercial_terms). */
export const DEFAULT_MARGIN_PERCENT = 8;
export const DEFAULT_TRUCKER_ADVANCE_PERCENT = 80;
/** "If the margin is under 6%, the team negotiates with the shipper before sending." */
export const MIN_MARGIN_PERCENT = 6;
/** "Calls partners who haven't bid in 5 minutes." */
export const PARTNER_CALL_AFTER_MS = 5 * 60 * 1000;
/** TDS on a partner's payments when the partner master has no rate of its own (194C, 1%). */
export const DEFAULT_TDS_PERCENT = 1;
export const DEFAULT_GST_PERCENT = 12;
export const DEFAULT_INVOICE_DUE_DAYS = 15;
