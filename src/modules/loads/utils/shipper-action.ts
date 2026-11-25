import { LoadRoute, LoadStatus, PodStatus } from './loads.types';
import { hasLoadingPapers } from './load-stages';

/**
 * Pure rule: the one thing the shipper's load screen asks of them now — the redesigned flow shows
 * a single action card per load ("Send the invoice for the e-LR", "Approve charges of ₹4,850",
 * "Record the balance you paid", "Pay ₹58,400", "Nothing for you to do"…). Worked out here so
 * the app never re-implements the stage rules.
 */

export const SHIPPER_ACTIONS = [
  'pick_bid', // bids are in, none accepted yet
  'accept_memo', // the memo is waiting for the shipper
  'send_invoice', // Loadsmart load at the loading point: the goods invoice makes the e-LR
  'loading_papers', // own routes at the loading point: LR, e-way bill, invoice
  'approve_charges', // charges waiting for the shipper
  'record_advance', // own transporter / indent: Loaded, advance not recorded
  'upload_pod', // at the unloading point, no POD image yet (or the last one was rejected)
  'review_pod', // own routes: the POD is in and waiting for the shipper's decision
  'settle_issue', // own routes: delivered with issues, not yet resolved
  'upload_transporter_invoice', // own transporter / indent: delivered, before the balance
  'record_balance', // own transporter / indent: transporter's invoice in, balance not recorded
  'pay_invoice', // Loadsmart's invoice is open
  'none',
] as const;
export type ShipperActionKind = (typeof SHIPPER_ACTIONS)[number];

export interface ShipperActionInput {
  status: LoadStatus;
  route: LoadRoute | null;
  awardedParty: string | null;
  awardedBidId: string | null;
  memoAcceptedAt: Date | null;
  invoiceNumber: string | null;
  invoiceFileKey: string | null;
  ewayBillNumber: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
  podFileKey: string | null;
  podBackFileKey: string | null;
  /** E-POD review state — 'pending' until the shipper (or, on a Loadsmart load, Loadsmart) decides. */
  podStatus?: PodStatus | null;
  transporterInvoiceFileKey: string | null;
  advancePercentage: string | null;
  advancePaidAt: Date | null;
  balancePaidAt: Date | null;
  deliveryIssueSettledAt: Date | null;
  /** Charges still waiting for the shipper (raised by Loadsmart, not yet decided — including
   *  ones the shipper asked about). */
  pendingCharges: { count: number; total: number };
  /** Loadsmart's open invoice amount, when there is one. */
  invoiceOpen: number | null;
  /** A balance payment the shipper reported that Receivables hasn't matched yet. */
  paymentPendingMatch: boolean;
  /** A memo is out for the shipper to accept. */
  memoWaiting: boolean;
}

export interface ShipperAction {
  kind: ShipperActionKind;
  /** Charge count and total for `approve_charges`; the amount for `pay_invoice`. */
  amount?: number;
  count?: number;
  /** Why there is nothing to do — e.g. the payment is being matched. */
  reason?: string;
}

const OWN_ROUTES: readonly (LoadRoute | null)[] = ['own_transporter', 'indent', 'own_fleet'];

export function shipperActionFor(load: ShipperActionInput): ShipperAction {
  const own = OWN_ROUTES.includes(load.route);
  const pays = load.route === 'own_transporter' || load.route === 'indent';

  if (load.status === 'cancelled' || load.status === 'closed') return { kind: 'none' };
  if (load.status === 'bids_received' && !load.awardedBidId) return { kind: 'pick_bid' };
  if (load.memoWaiting && !load.memoAcceptedAt) return { kind: 'accept_memo' };
  // Charges come first whenever they wait — they can be raised at any stage.
  if (load.pendingCharges.count > 0) {
    return {
      kind: 'approve_charges',
      count: load.pendingCharges.count,
      amount: load.pendingCharges.total,
    };
  }
  if (load.status === 'reached_loading') {
    if (load.route === 'loadsmart') {
      return load.invoiceFileKey
        ? { kind: 'none', reason: 'Loadsmart is making the e-LR' }
        : { kind: 'send_invoice' };
    }
    if (own && !hasLoadingPapers(load)) return { kind: 'loading_papers' };
  }
  if (pays && load.status !== 'created' && !load.advancePaidAt && loadedOrLater(load.status)) {
    if (Number(load.advancePercentage ?? 0) > 0) return { kind: 'record_advance' };
  }
  if (load.status === 'reached_unloading' && (!load.podFileKey || load.podStatus === 'rejected')) {
    return { kind: 'upload_pod' };
  }
  // The shipper decides the POD on their own routes; on a Loadsmart load Loadsmart's Tracking
  // team does (LoadService.reviewPod), so there is nothing for the shipper to do.
  if (
    load.status === 'reached_unloading' &&
    load.podStatus === 'pending' &&
    load.route !== 'loadsmart'
  ) {
    return { kind: 'review_pod' };
  }
  // A Loadsmart load: Loadsmart's Tracking team decides the POD, then its Receivables team raises
  // the invoice the shipper pays — until then the shipper only waits, and is told so.
  if (load.route === 'loadsmart' && load.status === 'reached_unloading' && load.podFileKey) {
    return {
      kind: 'none',
      reason: 'Loadsmart is checking the POD. Its invoice follows once the POD is accepted',
    };
  }
  if (load.route === 'loadsmart' && load.status === 'delivered_ok') {
    return { kind: 'none', reason: 'Loadsmart is preparing its invoice for you' };
  }
  if (load.status === 'delivered_with_issues' && own && !load.deliveryIssueSettledAt) {
    return { kind: 'settle_issue' };
  }
  if (pays && load.status === 'delivered_ok' && !load.transporterInvoiceFileKey) {
    return { kind: 'upload_transporter_invoice' };
  }
  if (pays && load.status === 'invoice_generated' && !load.balancePaidAt) {
    return { kind: 'record_balance' };
  }
  if (
    load.route === 'loadsmart' &&
    (load.status === 'invoice_generated' || load.status === 'payment')
  ) {
    if (load.paymentPendingMatch) {
      return { kind: 'none', reason: 'Loadsmart is matching your payment against its bank' };
    }
    if (load.invoiceOpen !== null && load.invoiceOpen > 0) {
      return { kind: 'pay_invoice', amount: load.invoiceOpen };
    }
  }
  return { kind: 'none' };
}

const LOADED_OR_LATER: readonly LoadStatus[] = [
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
  'delivered_ok',
  'delivered_with_issues',
  'invoice_generated',
  'payment',
];
const loadedOrLater = (status: LoadStatus) => LOADED_OR_LATER.includes(status);
