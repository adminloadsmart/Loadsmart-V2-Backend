import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ZodObject } from 'zod';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  DISPATCH_PLANNING_MANAGE,
  LS_APPROVAL,
  LS_CS,
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_RECEIVABLES,
  LS_TRACKING,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { TAGS, authenticated, json, permissionGated } from '../../shared/openapi/core';
import { loadsmartValidators as v } from './loadsmart.validators';

/** OpenAPI docs for the Loadsmart ops console (/loadsmart-ops) and the shipper's Loadsmart
 *  routes — table-driven, one row per route in loadsmart.routes.ts. */

const OPS = `${API_VERSION_PREFIX}/loadsmart-ops`;
const LOADS = `${API_VERSION_PREFIX}/loads`;
const ANY_TEAM = [LS_APPROVAL, LS_PLACEMENT, LS_TRACKING, LS_CS, LS_RECEIVABLES, LS_PAYABLES];

type Row = {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  op: string;
  description: string;
  permissions?: string[];
  schema?: ZodObject;
};

const ROWS: Row[] = [
  // Partners and terms
  {
    method: 'get',
    path: `${OPS}/partners`,
    op: 'loadsmart.listPartners',
    permissions: ANY_TEAM,
    description: "Loadsmart's partners — fleet owners and brokers.",
  },
  {
    method: 'post',
    path: `${OPS}/partners`,
    op: 'loadsmart.createPartner',
    permissions: [LS_PLACEMENT],
    schema: v.createPartner,
    description: 'Add a partner (TDS % defaults to 1).',
  },
  {
    method: 'patch',
    path: `${OPS}/partners/{partnerId}`,
    op: 'loadsmart.updatePartner',
    permissions: [LS_PLACEMENT],
    schema: v.updatePartner,
    description: 'Update a partner.',
  },
  {
    method: 'get',
    path: `${OPS}/terms/{tenantId}`,
    op: 'loadsmart.getTerms',
    permissions: ANY_TEAM,
    schema: v.getTerms,
    description:
      "A shipper's margin and trucker advance % (without terms of its own: the settings' central margin and default carrier advance).",
  },
  {
    method: 'put',
    path: `${OPS}/terms/{tenantId}`,
    op: 'loadsmart.saveTerms',
    permissions: [LS_APPROVAL],
    schema: v.saveTerms,
    description:
      "Set a shipper's margin, trucker advance % and pre-approved charge heads (each with an optional maximum).",
  },
  // Part 1
  {
    method: 'get',
    path: `${OPS}/approval-queue`,
    op: 'loadsmart.approvalQueue',
    permissions: [LS_APPROVAL],
    description: 'Market loads waiting for the Approval team, with anything flagged missing.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/approve`,
    op: 'loadsmart.approve',
    permissions: [LS_APPROVAL],
    schema: v.approve,
    description:
      'Post the load on the load board. Partners see the target with the margin taken out. Missing fields must be acknowledged.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/reject`,
    op: 'loadsmart.reject',
    permissions: [LS_APPROVAL],
    schema: v.reject,
    description: "Don't take the load.",
  },
  {
    method: 'get',
    path: `${OPS}/load-board`,
    op: 'loadsmart.loadBoard',
    permissions: [LS_PLACEMENT],
    description:
      "The load board as partners see it — Loadsmart's rate to them, no shipper or margin.",
  },
  {
    method: 'get',
    path: `${OPS}/placement-queue`,
    op: 'loadsmart.placementQueue',
    permissions: [LS_PLACEMENT],
    description: 'Loads on the board.',
  },
  {
    method: 'get',
    path: `${OPS}/sourcings/{sourcingId}/placement`,
    op: 'loadsmart.placement',
    permissions: [LS_PLACEMENT],
    schema: v.sourcing,
    description:
      "Partner bids ranked (usable truck, then lowest rate) with Loadsmart's price for each, and the partners to call once the load has been on the board 5 minutes.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/partner-bids`,
    op: 'loadsmart.recordPartnerBid',
    permissions: [LS_PLACEMENT],
    schema: v.partnerBid,
    description:
      "Record a partner's rate and truck (checked on VAHAN). Bids from salespeople are refused; quoting again revises the partner's bid.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/send-bid`,
    op: 'loadsmart.sendBid',
    permissions: [LS_PLACEMENT],
    schema: v.sendBid,
    description:
      "Send the shipper one bid as Loadsmart's — no partner name, priced at the margin unless shipperPrice is given. Under 6% margin needs negotiationNote.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/driver`,
    op: 'loadsmart.nameDriver',
    permissions: [LS_PLACEMENT],
    schema: v.nameDriver,
    description:
      "The partner's driver, licence (Sarathi) and papers. The memo goes to the shipper as soon as every check passes.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/verifications/rerun`,
    op: 'loadsmart.rerunChecks',
    permissions: [LS_PLACEMENT],
    schema: v.rerunChecks,
    description:
      'Run the truck and driver checks again on a Loadsmart load; the memo goes out once both pass.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/memo/confirm`,
    op: 'loadsmart.confirmMemo',
    permissions: [LS_PLACEMENT],
    schema: v.confirmMemo,
    description:
      'The shipper accepted the memo on a call — Placement marks it confirmed (acceptedVia: call). The load moves to Truck assigned and becomes a Loadsmart load.',
  },
  {
    method: 'get',
    path: `${OPS}/tracking-queue`,
    op: 'loadsmart.trackingQueue',
    permissions: [LS_TRACKING],
    description: 'Loadsmart loads on the road (read-only — the shipper runs the trip).',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/documents`,
    op: 'loadsmart.listDocuments',
    permissions: ANY_TEAM,
    schema: v.listDocuments,
    description:
      "A Loadsmart load's documents register — current files (history=true: every version) with review status.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/documents/{documentId}/review`,
    op: 'loadsmart.reviewDocument',
    permissions: [LS_TRACKING],
    schema: v.reviewDocument,
    description:
      'Tracking approves or rejects (with a reason) a current document on a Loadsmart load. POD documents are decided with the POD.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/pod/decision`,
    op: 'loadsmart.decidePod',
    permissions: [LS_TRACKING],
    schema: v.decidePod,
    description:
      'Tracking decides the POD on a Loadsmart load: accepted with no issue → Delivered; accepted with an issue (shortageOrDamage, issueDetails) → Delivered with issues; rejected (reason) → the driver resubmits.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-advance`,
    op: 'loadsmart.payPartnerAdvance',
    permissions: [LS_PAYABLES],
    schema: v.partnerPayment,
    description: 'Payables pays the carrier advance Super Admin approved, recording the UTR.',
  },
  {
    method: 'put',
    path: `${OPS}/partners/{partnerId}/claims`,
    op: 'loadsmart.setPartnerClaims',
    permissions: [LS_APPROVAL],
    schema: v.partnerClaims,
    description: 'Approval records the lanes and truck types a broker claims (replaces the lists).',
  },
  {
    method: 'patch',
    path: `${OPS}/partners/{partnerId}/profile`,
    op: 'loadsmart.updatePartnerProfile',
    permissions: [LS_APPROVAL],
    schema: v.partnerProfile,
    description:
      "A broker's advance on loading (changing it needs loadsmart.money.approve), note for Placement and trucker-sales contact.",
  },
  {
    method: 'get',
    path: `${OPS}/sourcings/{sourcingId}/brokers`,
    op: 'loadsmart.matchBrokers',
    permissions: [LS_PLACEMENT],
    schema: v.matchBrokers,
    description:
      'Brokers for a load: matched ones ticked with why (lane, truck type), loads placed on the lane, rating.',
  },
  {
    method: 'get',
    path: `${OPS}/placement/inbox`,
    op: 'loadsmart.placementInbox',
    permissions: [LS_PLACEMENT, LS_SETTINGS_MANAGE],
    schema: v.placementInbox,
    description:
      "Placement's loads by bucket: price due, offer with shipper, truck and driver due, memo sent.",
  },
  {
    method: 'get',
    path: `${OPS}/placement/roster`,
    op: 'loadsmart.getRoster',
    permissions: [LS_SETTINGS_MANAGE, LS_PLACEMENT],
    description: 'The Placement round-robin roster: who is on duty, in turn order.',
  },
  {
    method: 'put',
    path: `${OPS}/placement/roster`,
    op: 'loadsmart.saveRoster',
    permissions: [LS_SETTINGS_MANAGE],
    schema: v.saveRoster,
    description:
      'Super Admin sets the round-robin roster. New loads go one by one to members on duty, from midnight IST.',
  },
  {
    method: 'patch',
    path: `${OPS}/sourcings/{sourcingId}/owner`,
    op: 'loadsmart.moveOwner',
    permissions: [LS_SETTINGS_MANAGE],
    schema: v.moveOwner,
    description: 'Move a load to another Placement member.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/lost`,
    op: 'loadsmart.markLost',
    permissions: [LS_PLACEMENT],
    schema: v.markLost,
    description: 'Mark a load lost with a reason code from settings, a note and the rates heard.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/memo/withdraw`,
    op: 'loadsmart.withdrawMemo',
    permissions: [LS_PLACEMENT],
    schema: v.withdrawMemo,
    description: 'Withdraw an open memo with a reason.',
  },
  {
    method: 'post',
    path: `${OPS}/shippers/{tenantId}/loads`,
    op: 'loadsmart.postForShipper',
    permissions: [LS_APPROVAL],
    schema: v.postForShipper,
    description:
      'Approval posts a load for a shipper (market fleet), recording who asked, on which channel, and the proof.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/ls-charges`,
    op: 'loadsmart.raiseCharge',
    permissions: [LS_TRACKING],
    schema: v.raiseCharge,
    description:
      'Tracking raises a charge with proof. A head the shipper pre-approved (within its amount) is approved as raised; otherwise the shipper approves, rejects or queries it.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/ls-charges/{chargeId}/reply`,
    op: 'loadsmart.replyToChargeQuery',
    permissions: [LS_TRACKING],
    schema: v.replyToChargeQuery,
    description:
      "Tracking answers the shipper's query on a charge; it goes back to the shipper to decide.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/elr`,
    op: 'loadsmart.issueElr',
    permissions: [LS_TRACKING],
    schema: v.issueElr,
    description:
      'Issue the e-LR (one series across Loadsmart, LSLR-nnnnnn) from the invoice, at the loading point.',
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/elr`,
    op: 'loadsmart.editElr',
    permissions: [LS_TRACKING],
    schema: v.editElr,
    description:
      'Edit the e-LR with a reason (driver replaced, wrong details, relief driver, transhipment): a new PDF under the same number.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/elr/cancel`,
    op: 'loadsmart.cancelElr',
    permissions: [LS_TRACKING],
    schema: v.cancelElr,
    description: 'Cancel the e-LR. Its number is never reused.',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/elr/revisions`,
    op: 'loadsmart.elrRevisions',
    permissions: [LS_APPROVAL, LS_PLACEMENT, LS_TRACKING, LS_CS, LS_RECEIVABLES, LS_PAYABLES],
    schema: v.load,
    description: "The e-LR's history: issued, edited (with reason), cancelled.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-advance/raise`,
    op: 'loadsmart.raisePartnerAdvance',
    permissions: [LS_TRACKING],
    schema: v.load,
    description:
      "Tracking raises the carrier advance once Loaded: the broker's advance % (or the default) of the trip plus approved loading-side charges, less TDS. A rejected advance can be raised again.",
  },
  {
    method: 'get',
    path: `${OPS}/partner-payments`,
    op: 'loadsmart.partnerPayments',
    permissions: [LS_MONEY_APPROVE, LS_PAYABLES],
    schema: v.partnerPayments,
    description:
      "Carrier payments by status (default: raised and on hold — Super Admin's queue; approved — Payables').",
  },
  {
    method: 'post',
    path: `${OPS}/partner-payments/{paymentId}/decision`,
    op: 'loadsmart.decidePartnerPayment',
    permissions: [LS_MONEY_APPROVE],
    schema: v.decidePartnerPayment,
    description:
      'Super Admin approves, holds or rejects a carrier payment (a reason to hold or reject).',
  },
  // Delivery and money
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/ratings`,
    op: 'loadsmart.rate',
    permissions: [LS_PAYABLES],
    schema: v.rate,
    description: 'Rate the shipper and the carrier (1–5).',
  },
  {
    method: 'get',
    path: `${OPS}/claims`,
    op: 'loadsmart.claimsInbox',
    permissions: [LS_CS, LS_TRACKING],
    schema: v.claimsInbox,
    description:
      'Open claims on loads delivered with issues, oldest first, with age and agent; unassigned ones flagged (mine=true: assigned to me).',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/claim`,
    op: 'loadsmart.getClaim',
    permissions: [LS_CS, LS_TRACKING],
    schema: v.load,
    description:
      'A claim with its evidence (POD, damage photos, what CS added), credit notes and the load.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/claim/assign`,
    op: 'loadsmart.assignClaim',
    permissions: [LS_TRACKING],
    schema: v.assignClaim,
    description:
      'Tracking assigns the claim to a Customer support member (must hold loadsmart.cs).',
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/claim`,
    op: 'loadsmart.updateClaim',
    permissions: [LS_CS],
    schema: v.updateClaim,
    description:
      "CS works the claim: assessment, agreed amount, who bears it (carrier, split with the carrier's share, or Loadsmart), the shipper's debit note, evidence files (purpose loads/claim-evidence).",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/claim/close`,
    op: 'loadsmart.closeClaim',
    permissions: [LS_CS],
    schema: v.closeClaim,
    description:
      "Close the claim (agreed amount and who bears it required): Loadsmart's credit note to the shipper (LSCN-nnnn), the carrier's share comes off its balance, and the load moves to Delivered without issues (or settles where it is if already billed).",
  },
  {
    method: 'get',
    path: `${OPS}/receivables/inbox`,
    op: 'loadsmart.receivablesInbox',
    permissions: [LS_RECEIVABLES],
    description:
      'To invoice (late after the target days; held for shippers billed on the original POD), overdue, short or excess, not yet received, unclaimed payments, total open and ageing (not due, 1–15, 16–30, 31–45, over 45 days).',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/invoice/preview`,
    op: 'loadsmart.invoicePreview',
    permissions: [LS_RECEIVABLES],
    schema: v.load,
    description:
      "The invoice as it would be issued now — freight, approved charges with billing instructions applied, GST (reverse charge; CGST + SGST inside Loadsmart's state, IGST outside), advance received, balance due — and what still stops it.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/invoice`,
    op: 'loadsmart.issueInvoice',
    permissions: [LS_RECEIVABLES],
    schema: v.load,
    description:
      'Issue the invoice (LSI-nnnn, PDF) once the POD image is approved, no charge is waiting, and — for shippers billed on the original — the original POD is in. Delivered (with or without issues) → Invoice generated.',
  },
  {
    method: 'patch',
    path: `${OPS}/invoices/{invoiceId}/delivery`,
    op: 'loadsmart.invoiceDelivery',
    permissions: [LS_RECEIVABLES],
    schema: v.invoiceDelivery,
    description:
      'Record how the invoice went (app, email, WhatsApp, courier — nothing is sent from here) and when the shipper received it; the due date is receipt + credit days.',
  },
  {
    method: 'get',
    path: `${OPS}/invoices/{invoiceId}/receipts`,
    op: 'loadsmart.listReceipts',
    permissions: [LS_RECEIVABLES],
    schema: v.invoice,
    description:
      'Receipts, credit notes and the payments the shipper reported in the app on an invoice.',
  },
  {
    method: 'post',
    path: `${OPS}/invoices/{invoiceId}/receipts`,
    op: 'loadsmart.recordReceipt',
    permissions: [LS_RECEIVABLES],
    schema: v.recordReceipt,
    description:
      'Record money received (matched by hand against the bank statement): amount, date, paid through, UTR, TDS cut, and a reason for any shortfall. Reconciles the invoice (paid, short paid, partly paid with a follow-up, excess), moves the load to Payment, and closes it once the carrier is paid too. loadPaymentId verifies a payment the shipper reported.',
  },
  {
    method: 'get',
    path: `${OPS}/unclaimed-payments`,
    op: 'loadsmart.listUnclaimed',
    permissions: [LS_RECEIVABLES],
    schema: v.listUnclaimed,
    description:
      'Money in the bank that matches no customer or invoice (default: unclaimed and under review).',
  },
  {
    method: 'post',
    path: `${OPS}/unclaimed-payments`,
    op: 'loadsmart.addUnclaimed',
    permissions: [LS_RECEIVABLES],
    schema: v.addUnclaimed,
    description: 'Log an unclaimed payment: amount, payer, mode, UTR, remitter bank.',
  },
  {
    method: 'patch',
    path: `${OPS}/unclaimed-payments/{paymentId}`,
    op: 'loadsmart.updateUnclaimed',
    permissions: [LS_RECEIVABLES],
    schema: v.updateUnclaimed,
    description: 'Add a remark, and optionally mark it under review or refunded to the payer.',
  },
  {
    method: 'post',
    path: `${OPS}/unclaimed-payments/{paymentId}/match`,
    op: 'loadsmart.matchUnclaimed',
    permissions: [LS_RECEIVABLES],
    schema: v.matchUnclaimed,
    description: 'Match an unclaimed payment to an invoice — it becomes a receipt on it.',
  },
  {
    method: 'get',
    path: `${OPS}/original-pods`,
    op: 'loadsmart.originalPods',
    permissions: [LS_PAYABLES],
    schema: v.originalPods,
    description:
      'The original POD tracker: every delivered load until its original is filed at Mohali — days since delivery, status, holder, last call, penalty (filters: status, pastDue, shipperNeedsOriginal).',
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/original-pod`,
    op: 'loadsmart.updateOriginalPod',
    permissions: [LS_PAYABLES],
    schema: v.updateOriginalPod,
    description:
      'Update the original POD: dispatched (courier and docket), received and filed (freezes the late penalty and unlocks the carrier balance), not contactable, not traceable (an indemnity bond is required).',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/original-pod/calls`,
    op: 'loadsmart.logOriginalPodCall',
    permissions: [LS_PAYABLES],
    schema: v.originalPodCall,
    description: 'Log a follow-up call on the original POD.',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/partner-balance`,
    op: 'loadsmart.balancePreview',
    permissions: [LS_PAYABLES, LS_MONEY_APPROVE],
    schema: v.load,
    description:
      'The carrier balance as it stands — freight + approved charges − paid advance − TDS − late original POD penalty − claim recovery — and what holds it.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-balance/raise`,
    op: 'loadsmart.raiseBalance',
    permissions: [LS_PAYABLES],
    schema: v.load,
    description:
      'Raise the carrier balance for Super Admin once the original POD is filed (and, with damage noted, the claim closed and the shipper paid). A rejected balance can be raised again.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-balance`,
    op: 'loadsmart.payPartnerBalance',
    permissions: [LS_PAYABLES],
    schema: v.partnerPayment,
    description:
      'Pay the carrier balance Super Admin approved, recording the UTR. Closes the load once the shipper is settled too.',
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}`,
    op: 'loadsmart.loadDetail',
    permissions: ANY_TEAM,
    schema: v.load,
    description:
      'Everything Loadsmart holds on a load — sourcing, partner bids and payments, charges, claim, invoice, ratings.',
  },
  // Shipper side
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/charges`,
    op: 'loads.listCharges',
    schema: v.load,
    permissions: [PAYMENTS_MANAGE, DISPATCH_PLANNING_MANAGE],
    description: 'Charges on a Loadsmart load.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/charges/{chargeId}/decision`,
    op: 'loads.decideCharge',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.decideCharge,
    description:
      "Approve, reject or query (with a reason) a charge Loadsmart raised. Loadsmart's Tracking answers a query and the charge comes back for a decision.",
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/charges`,
    op: 'loads.addCharge',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.addCharge,
    description:
      'Add a loading (at the loading point), unloading (at the drop) or detention (during the trip) charge. It counts as approved and goes on the invoice.',
  },
  {
    method: 'put',
    path: `${OPS}/loads/{loadId}/unloading-details`,
    op: 'loadsmart.setUnloadingDetails',
    permissions: [LS_TRACKING],
    schema: v.unloadingDetails,
    description:
      "Tracking adds a Loadsmart load's unloading details — the receiver or the appointment (ID, date, slot).",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/claim`,
    op: 'loads.getClaim',
    schema: v.load,
    permissions: [PAYMENTS_MANAGE, DISPATCH_PLANNING_MANAGE],
    description: 'The claim on a Loadsmart load delivered with issues.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/claim`,
    op: 'loads.addClaimValue',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.claimValue,
    description:
      "Add the amount the shipper claims. Loadsmart's Customer support agrees the amount and issues a credit note.",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/invoice`,
    op: 'loads.getLoadsmartInvoice',
    schema: v.load,
    permissions: [PAYMENTS_MANAGE],
    description:
      "Loadsmart's invoice and its PDF. Report a payment with POST /loads/{loadId}/payments/balance (with the UTR); Receivables matches it against the bank.",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/documents-bundle`,
    op: 'loads.documentsBundle',
    schema: v.load,
    description: 'Every document on the load with download URLs, the load memo and the payments.',
  },
];

export function registerLoadsmartOpenApi(registry: OpenAPIRegistry): void {
  for (const row of ROWS) {
    const shape = row.schema?.shape as
      { params?: ZodObject; query?: ZodObject; body?: ZodObject } | undefined;
    registry.registerPath({
      method: row.method,
      path: row.path,
      tags: [TAGS.LOADS],
      operationId: row.op,
      ...(row.permissions
        ? permissionGated(row.permissions, row.description)
        : authenticated(row.description)),
      request: {
        ...(shape?.params ? { params: shape.params } : {}),
        ...(shape?.query ? { query: shape.query } : {}),
        ...(shape?.body ? { body: json(shape.body) } : {}),
      },
      responses: { 200: { description: 'OK' } },
    });
  }
}
