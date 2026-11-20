/**
 * Load moments the other side of a load is told about on WhatsApp (modules/messaging): the
 * shipper (load memo), the Loadsmart partner (payments, original POD) and the shipper's own
 * transporter (payments). Stage moves reach messaging through the load-event notifier instead;
 * these are the moments that don't move a stage.
 */
export type LoadPartyNotice =
  /** LS_N_0103 — a transporter's bid (new or revised) on a market load; the shipper gets the
   *  first one and a roll-up at most every 30 minutes. */
  | { kind: 'bid_received'; tenantId: string; loadId: string; bidId: string }
  /** LS_N_0067 — Placement sent Loadsmart's bid (new or revised) to the shipper. */
  | { kind: 'loadsmart_bid_sent'; tenantId: string; loadId: string; bidId: string }
  /** LS_N_0069 — a load memo version was sent; the shipper accepts it. */
  | { kind: 'memo_sent'; tenantId: string; loadId: string; memoId: string }
  /** LS_N_0112 — Loadsmart paid its partner (advance or balance), with the UTR and proof. */
  | { kind: 'partner_paid'; tenantId: string; loadId: string; partnerPaymentId: string }
  /** LS_N_0126 — the shipper recorded the advance or the final payment to its transporter. */
  | { kind: 'transporter_payment_recorded'; tenantId: string; loadId: string; paymentId: string }
  /** LS_N_0108 — a truck or driver failed its check before the memo; the broker (Loadsmart load)
   *  or the transporter (own transporter, indent) is asked for another. One per failed check. */
  | { kind: 'check_failed'; tenantId: string; loadId: string; failures: FailedCheck[] }
  /** LS_N_0117 — Payables marked the partner's original POD received. */
  | { kind: 'original_pod_received'; tenantId: string; loadId: string };

/** One failed check: "truck HR55AB1234" / "driver Ramesh Kumar", and why in plain words. */
export interface FailedCheck {
  item: string;
  issue: string;
}

/** Never throws: a WhatsApp problem must not fail the load step that triggered it. */
export type LoadPartyNotifier = (notice: LoadPartyNotice) => Promise<void>;
