/**
 * Charge heads on a load — the spec's list for own-transporter and indent loads ("loading, loading
 * detention, tarpaulin, overloading, parking, godown, unloading, unloading detention, other with
 * remark"), plus toll/gate (added after the Figma review). `detention` is the older single head Loadsmart loads still use; Loadsmart's own subset
 * is loadsmart-ops CHARGE_TYPES.
 */
export const CHARGE_HEADS = [
  'loading',
  'loading_detention',
  'tarpaulin',
  'overloading',
  'parking',
  'godown',
  'unloading',
  'unloading_detention',
  // Tolls and gate fees on the way — paid with the balance.
  'toll',
  'other',
  'detention',
] as const;
export type ChargeHead = (typeof CHARGE_HEADS)[number];

/** What the shipper adds on an own-transporter or indent load — `detention` is Loadsmart's. */
export const TRANSPORTER_CHARGE_HEADS = CHARGE_HEADS.filter(
  (head): head is Exclude<ChargeHead, 'detention'> => head !== 'detention',
);
export type TransporterChargeHead = (typeof TRANSPORTER_CHARGE_HEADS)[number];

/** `queried`: the shipper asked about it (with a reason); Loadsmart's reply puts it back to
 *  `raised`. `pending_admin`: a Loadsmart-raised charge the shipper approved (or pre-approved) that
 *  now waits for Super Admin — only `approved` counts toward the invoice and the carrier's pay. */
export const CHARGE_STATUSES = [
  'raised',
  'queried',
  'pending_admin',
  'approved',
  'rejected',
] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Who raised the charge — Loadsmart's team, or the shipper (approved as it is entered). */
export const CHARGE_RAISERS = ['loadsmart', 'shipper'] as const;
export type ChargeRaiser = (typeof CHARGE_RAISERS)[number];

/** What kind of answer Tracking gives to the shipper's question on a charge. */
export const CHARGE_REPLY_TAGS = [
  'clarification',
  'proof_shared',
  'amount_revised',
  'other',
] as const;
export type ChargeReplyTag = (typeof CHARGE_REPLY_TAGS)[number];
