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
  LS_MASTERS_MANAGE,
  LS_TRUCK_VERIFY_MANUAL,
  LS_DRIVER_VERIFY_MANUAL,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { TAGS, authenticated, json, permissionGated } from '../../shared/openapi/core';
import { loadsmartValidators as v } from './loadsmart.validators';

/** OpenAPI docs for the Loadsmart ops console (/loadsmart-ops) and the shipper's Loadsmart
 *  routes — table-driven, one row per route in loadsmart.routes.ts. */

const OPS = `${API_VERSION_PREFIX}/loadsmart-ops`;
const LOADS = `${API_VERSION_PREFIX}/loads`;
const ANY_TEAM = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_TRACKING,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
];

type Row = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
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
    permissions: [LS_PLACEMENT, LS_MASTERS_MANAGE],
    description:
      "Loadsmart's partners — fleet owners and brokers. Placement (to add a broker matching missed) and the Admin team.",
  },
  {
    method: 'post',
    path: `${OPS}/partners`,
    op: 'loadsmart.createPartner',
    permissions: [LS_MASTERS_MANAGE],
    schema: v.createPartner,
    description: 'Add a partner (TDS % defaults to 1). Admin team only — partners are a master.',
  },
  {
    method: 'patch',
    path: `${OPS}/partners/{partnerId}`,
    op: 'loadsmart.updatePartner',
    permissions: [LS_MASTERS_MANAGE],
    schema: v.updatePartner,
    description: 'Update a partner. Admin team only — partners are a master.',
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
      "Set a shipper's trucker advance % and, Admin team only (loadsmart.margin.manage), margin %. Without marginPercent the current margin is kept; sending it without that key is a 403.",
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
      'Post the load on the load board. Partners see the target with the margin taken out. Missing fields must be acknowledged. Overriding marginPercent is Admin team only (403 otherwise).',
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
      "Record a broker response: response (bid — the default — declined, no_truck, call_back_later), rate (required for a bid), channel (manual_entry, phone, whatsapp, email), note, and a truck (checked on VAHAN). Every response goes in the broker's bid history; only a bid becomes (or revises) the broker's live bid. Bids from salespeople are refused.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/send-bid`,
    op: 'loadsmart.sendBid',
    permissions: [LS_PLACEMENT],
    schema: v.sendBid,
    description:
      "Send the shipper one bid as Loadsmart's — no partner name, priced at the margin unless shipperPrice is given. Under 5% margin needs negotiationNote.",
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
    path: `${OPS}/loads/{loadId}/driver/documents`,
    op: 'loadsmart.updateDriverDocuments',
    permissions: [LS_PLACEMENT],
    schema: v.updateDriverDocuments,
    description:
      "Replace or add the driver's licence photos (front/back) and the RC copy without naming the driver again. They go into the next memo.",
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
    path: `${OPS}/loads/{loadId}/verifications/truck/manual`,
    op: 'loadsmart.verifyTruckManually',
    permissions: [LS_TRUCK_VERIFY_MANUAL, LS_PLACEMENT],
    schema: v.verifyTruckManually,
    description:
      "VAHAN couldn't be reached for the truck on a Loadsmart load — Placement (or the Admin team) checks the RC by hand (rcChecked, optional paper expiry dates). The memo goes out once every check passes.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/verifications/driver/manual`,
    op: 'loadsmart.verifyDriverManually',
    permissions: [LS_DRIVER_VERIFY_MANUAL, LS_PLACEMENT],
    schema: v.verifyDriverManually,
    description:
      "Sarathi couldn't confirm the driver's licence on a Loadsmart load (not reachable, or no match) — the Admin team checks it by hand (licenceChecked, optional validity date). The memo goes out once every check passes.",
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
    description:
      'Payables pays the carrier advance Super Admin approved, recording the UTR, the payment advice (`proofFileKey`, purpose loads/payment-proof), or both.',
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
      "Brokers for a load: matched ones ticked with why (lane, truck type) — and any Placement added by hand (`added`) — loads placed on the lane, rating. Each broker has `whatsapp`: null when the requirement was never sent to them, else { status (`sent` / `not_on_whatsapp` / `failed`), sentAt, deliveredAt, readAt (from WhatsApp's reports), failReason, lastReply } — lastReply is the broker's newest answer that came in on WhatsApp: { response (`bid` / `declined` = Reject / `negotiating` = Negotiate or Give rate tapped, rate not sent yet), rate, at } or null.",
  },
  {
    method: 'get',
    path: `${OPS}/placement/loads`,
    op: 'loadsmart.placementBoard',
    permissions: [LS_PLACEMENT, LS_SETTINGS_MANAGE],
    schema: v.placementBoard,
    description:
      'Placement Work Queue: tiles (loads worked = owned by you, placed, not placed, memo confirmed), a count per tab (all, without_bids, with_bids, placed, mine, pickup_today, memo_sent, memo_confirmed) and one row per load — load and LR, shipper, goods, route, reporting time, truck type, expected price, brokers matched, active bids, memo state (not_sent / sent / expired / accepted). Filter by tab, shipper, or search load, LR, shipper, route or truck. Paged (default 10).',
  },
  {
    method: 'get',
    path: `${OPS}/placement/loads/{sourcingId}`,
    op: 'loadsmart.placementPage',
    permissions: [LS_PLACEMENT, LS_SETTINGS_MANAGE],
    schema: v.sourcing,
    description:
      "Placement's load page: the queue row, Load requirements (pickup, drop, full pickup and drop addresses, truck and length, goods and weight, report by, shipper balance terms), Pricing guidance (expected price, shipper price, market rate = median carrier trip amount on the lane over 90 days, rate ceiling = the highest carrier rate that keeps Settings' margin floor), the bid window (hours, closes at, closed), when the requirement went out, the rate handoff (broker, chosen rate, price to the shipper), the latest bid per broker (with `channel` — how its latest rate came in: whatsapp / manual_entry / phone / email — and `updatedAt`), the call list, the memo (state, truck, driver, licence) and team contacts.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/brokers`,
    op: 'loadsmart.addBroker',
    permissions: [LS_PLACEMENT],
    schema: v.addBroker,
    description: "Add broker: puts an active broker on this load's matched list by hand.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/brokers/bulk`,
    op: 'loadsmart.addBrokers',
    permissions: [LS_PLACEMENT],
    schema: v.addBrokers,
    description:
      "Add brokers: puts several broker-master brokers on this load's matched list at once. Each broker is added on its own, so one already on the list or no longer approved is reported under `failed` without blocking the rest.",
  },
  {
    method: 'delete',
    path: `${OPS}/sourcings/{sourcingId}/brokers/{partnerId}`,
    op: 'loadsmart.removeBroker',
    permissions: [LS_PLACEMENT],
    schema: v.sourcingBroker,
    description: "Takes a broker added by hand off the load's list.",
  },
  {
    method: 'get',
    path: `${OPS}/sourcings/{sourcingId}/brokers/{partnerId}/bid-history`,
    op: 'loadsmart.bidHistory',
    permissions: [LS_PLACEMENT, LS_SETTINGS_MANAGE],
    schema: v.sourcingBroker,
    description:
      'Broker bid history: every response the broker gave on the load (bid, declined, no_truck, call_back_later), with rate, channel and note, newest first.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/broker-calls`,
    op: 'loadsmart.logBrokerCall',
    permissions: [LS_PLACEMENT],
    schema: v.brokerCall,
    description:
      'Log broker call: outcome (connected = "Picked up", no_answer, busy, switched_off, wrong_number, not_interested, call_back_later), quoted rate, remarks.',
  },
  {
    method: 'get',
    path: `${OPS}/sourcings/{sourcingId}/broker-calls`,
    op: 'loadsmart.brokerCalls',
    permissions: [LS_PLACEMENT, LS_SETTINGS_MANAGE],
    schema: v.sourcing,
    description: 'Broker call history, grouped by broker, newest first.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/bid-window`,
    op: 'loadsmart.extendBidWindow',
    permissions: [LS_PLACEMENT],
    schema: v.extendBidWindow,
    description:
      'Extend bid window: 1–24 more hours (with a reason) on a market load still taking bids. It applies to every bidder; a window that already closed reopens from now.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/requirement`,
    op: 'loadsmart.sendRequirement',
    permissions: [LS_PLACEMENT],
    schema: v.sendRequirement,
    description:
      "Send Requirement (spec step 4): sends the load's WhatsApp offer from Loadsmart's business number — LS_N_0105 with the partner rate (Accept / Negotiate / Reject) or LS_N_0106 asking for rates (Give rate / Reject) — to the brokers Placement picked. Without partnerIds, the load's matched brokers and any added by hand. Nothing goes to brokers when the load is posted. Each broker's outcome is saved: `sent`, `not_on_whatsapp` (no message — call them) or `failed` (with the reason); delivered and read times follow from WhatsApp. A broker already sent to is skipped (`already_sent`), so sending again reaches only the new ones; a failed one is tried again. Returns { sentAt, sentCount, recipients[] }; each recipient has partnerId, name, phone, status, failReason, sentAt, deliveredAt, readAt (for `already_sent`: when it first went and what WhatsApp reported since). Later receipts and replies: GET .../sourcings/{sourcingId}/brokers (`whatsapp`).",
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
    description:
      "Move a load to another team member: Placement's owner by default, or Tracking's with `team: 'tracking'`.",
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
    method: 'get',
    path: `${OPS}/shipper-accounts`,
    op: 'loadsmart.shipperAccounts',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccounts,
    description:
      "Approval's Shippers master: every shipper with status, contact, loads in the last 30 days and last load. Filter by status, search by name or city.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}`,
    op: 'loadsmart.shipperAccount',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description:
      "One shipper's profile: header, KPIs, company, Loadsmart terms (no margin) and the counts on each tab.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/loading-points`,
    op: 'loadsmart.shipperAccountLoadingPoints',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description: "A shipper's loading points for the Shippers master.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/consignees`,
    op: 'loadsmart.shipperAccountConsignees',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description: "A shipper's consignees for the Shippers master.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/documents`,
    op: 'loadsmart.shipperAccountDocuments',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description: "A shipper's documents for the Shippers master.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/invoices`,
    op: 'loadsmart.shipperAccountInvoices',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description: "A shipper's invoices for the Shippers master.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/tickets`,
    op: 'loadsmart.shipperAccountTickets',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccount,
    description: "A shipper's tickets for the Shippers master.",
  },
  {
    method: 'get',
    path: `${OPS}/shipper-accounts/{tenantId}/activity`,
    op: 'loadsmart.shipperAccountActivity',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccountActivity,
    description: "What happened on a shipper's account, newest first, with who did it.",
  },
  {
    method: 'put',
    path: `${OPS}/shipper-accounts/{tenantId}/terms`,
    op: 'loadsmart.saveShipperAccountTerms',
    permissions: [LS_APPROVAL],
    schema: v.shipperAccountTerms,
    description:
      "Edit a shipper's operations terms: advance, who pays the balance, credit days, POD type, physical LR, preapproved charges and billing rules. Margin and the trucker advance are kept.",
  },
  {
    method: 'get',
    path: `${OPS}/shippers`,
    op: 'loadsmart.listShippers',
    permissions: [LS_APPROVAL],
    schema: v.listShippers,
    description:
      "Approval's shipper list for posting a load on their behalf: name, city, whether they are approved (only an approved shipper can have loads posted) and their latest load. Search by name or city.",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/recent-customers`,
    op: 'loadsmart.shipperRecentCustomers',
    permissions: [LS_APPROVAL],
    schema: v.shipperRecentCustomers,
    description:
      "The shipper's recent customers — the posting form's quick picks, read inside the shipper's account.",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/customers`,
    op: 'loadsmart.shipperCustomers',
    permissions: [LS_APPROVAL],
    schema: v.shipperCustomers,
    description: "Search the shipper's customers by name or code.",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/customers/{customerId}/unloading-points`,
    op: 'loadsmart.shipperUnloadingPoints',
    permissions: [LS_APPROVAL],
    schema: v.shipperUnloadingPoints,
    description: "A customer's saved unloading points (the drop list).",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/loading-points`,
    op: 'loadsmart.shipperLoadingPoints',
    permissions: [LS_APPROVAL],
    schema: v.shipperSearch,
    description:
      "The shipper's loading points (the pickup list; also the drop list when there is no customer).",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/commodities`,
    op: 'loadsmart.shipperCommodities',
    permissions: [LS_APPROVAL],
    schema: v.shipperSearch,
    description: "The shipper's commodity master, with each one's usual packaging.",
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/truck-options`,
    op: 'loadsmart.shipperTruckOptions',
    permissions: [LS_APPROVAL],
    schema: v.shipperTruckOptions,
    description:
      'The truck-type picker: body, then tyres or axle, then tonnes, then length — each step narrowed by the earlier picks.',
  },
  {
    method: 'get',
    path: `${OPS}/shippers/{tenantId}/posting/rules`,
    op: 'loadsmart.shipperPostingRules',
    permissions: [LS_APPROVAL],
    schema: v.shipperRecentCustomers,
    description: 'The posting timing rules from Settings (earliest reporting time, memo expiry).',
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
      "Tracking raises a charge (type, amount, optional remark; the proof file is optional). The shipper approves, rejects or queries it first (a head the shipper pre-approved skips this step), then Super Admin decides — only an admin-approved charge reaches the invoice and the carrier's pay.",
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
    schema: v.raiseAdvance,
    description:
      "Tracking raises the carrier advance once Loaded: the broker's advance % (or the default) of the trip plus approved loading-side charges, less TDS. `chargeIds` picks which approved loading-side charges go with it (default: all not yet sent); the rest are paid with the balance. A rejected advance, or one still waiting (raised / on hold), can be raised again with a different set. Payables and Super Admin get an in-app notice.",
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
    path: `${OPS}/receivables/loads`,
    op: 'loadsmart.receivablesBoard',
    permissions: [LS_RECEIVABLES],
    schema: v.receivablesBoard,
    description:
      "The Receivables board: every Loadsmart load from the truck loaded to the shipper's money closing, one row each — load and LR, shipper and route, invoice, amount (invoice total, else freight + approved charges), who pays the balance (shipper or consignee), balance due date and status (advance_due, advance_paid, pod_image_in, invoice_generated, awaiting_original_pod, pod_in_transit, pod_received_by_payer, invoice_paid_closed, short_excess) — with a count per status. Filter by status (repeatable), shipper, or search load, LR, shipper, consignee, invoice or POD docket.",
  },
  {
    method: 'get',
    path: `${OPS}/receivables/loads/{loadId}`,
    op: 'loadsmart.receivableLoad',
    permissions: [LS_RECEIVABLES],
    schema: v.load,
    description:
      "One load's receivables page: the freight invoice (freight, approved loading charges, GST treatment, invoice total, advance received and remaining, balance remaining and due date, what still blocks Generate invoice), the shipper's agreement (advance payer, %, where the % comes from — terms, the load, or Settings — expected advance, credit days, balance trigger image/original, balance payer), the charges, the receipt history (advances and balance receipts with their payment advice), payments the shipper reported, and delivery / POD (image, review, the original at Loadsmart and on to the payer).",
  },
  {
    method: 'post',
    path: `${OPS}/receivables/loads/{loadId}/receipts`,
    op: 'loadsmart.recordLoadReceipt',
    permissions: [LS_RECEIVABLES],
    schema: v.recordLoadReceipt,
    description:
      "Record receipt: `advance` — the shipper's advance, from the truck loaded until the invoice is out (it comes off the invoice); refused once received in full or when no advance is agreed. `balance` — money against the invoice (as POST /invoices/{id}/receipts; paidThrough defaults to company_account). The UTR is required; proofFileKey is the payment advice uploaded for loads/payment-proof, filed on the load. loadPaymentId confirms a payment the shipper reported in the app. Returns the load's receivables page.",
  },
  {
    method: 'patch',
    path: `${OPS}/invoices/{invoiceId}/payer-pod`,
    op: 'loadsmart.recordPayerPod',
    permissions: [LS_RECEIVABLES],
    schema: v.payerPod,
    description:
      "The original POD sent on from Loadsmart to whoever pays the balance (shippers billed on the original): in_transit with courier and docket, then received. Returns the load's receivables page.",
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/invoice/preview`,
    op: 'loadsmart.invoicePreview',
    permissions: [LS_RECEIVABLES],
    schema: v.invoicePreview,
    description:
      "The invoice as it would be issued now — freight, approved charges with billing instructions applied, GST (reverse charge; CGST + SGST inside Loadsmart's state, IGST outside), advance received, balance due — and what still stops it.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/invoice`,
    op: 'loadsmart.issueInvoice',
    permissions: [LS_RECEIVABLES],
    schema: v.issueInvoice,
    description:
      "gstTreatment (reverse_charge / forward_charge) overrides Settings for this invoice; the balance payer is taken from the shipper's terms. Issue the invoice (LSI-nnnn, PDF) once the POD image is approved, no charge is waiting, and — for shippers billed on the original — the original POD is in. Delivered (with or without issues) → Invoice generated.",
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
  // Cross-team views
  {
    method: 'get',
    path: `${OPS}/all-loads`,
    op: 'loadsmart.allLoads',
    permissions: ANY_TEAM,
    schema: v.allLoads,
    description:
      'All loads (L01): every Loadsmart load whichever team holds it — shipper, route, loading time, truck, movement, money, team holding it — with counts per team. Filters: status, tenantId, team, q (code, vehicle or driver mobile). Money is shown as the caller may see it: Placement and Super Admin both sides and the margin; Tracking and Payables carrier money; Receivables and Approval shipper money; CS none.',
  },
  {
    method: 'get',
    path: `${OPS}/all-loads/{loadId}`,
    op: 'loadsmart.loadPanel',
    permissions: ANY_TEAM,
    schema: v.load,
    description:
      "A load's panel: stage milestones, money on both sides (as the caller may see it), shipper and carrier advance status, goods and e-way bill, people with phone numbers, latest events, and the team holding it.",
  },
  {
    method: 'get',
    path: `${OPS}/approvals`,
    op: 'loadsmart.approvals',
    permissions: [LS_MONEY_APPROVE],
    description:
      'Super Admin approvals (S01): carrier advances and balances waiting (raised or on hold), load cancellations waiting, each worked out line by line with pay-to bank details, why it is here, how long it has waited and the load; plus the charges Loadsmart raised in the last 7 days. Decide on POST /partner-payments/{paymentId}/decision.',
  },
  {
    method: 'get',
    path: `${OPS}/cancellation-requests`,
    op: 'loadsmart.cancellationRequests',
    permissions: [LS_MONEY_APPROVE, LS_SETTINGS_MANAGE],
    description:
      "Shippers' cancellations of loads Loadsmart has won, waiting for Super Admin — reason code, the stage it was at, the truck on it, how long it has waited.",
  },
  {
    method: 'post',
    path: `${OPS}/cancellation-requests/{cancellationId}/decision`,
    op: 'loadsmart.decideCancellation',
    permissions: [LS_MONEY_APPROVE, LS_SETTINGS_MANAGE],
    schema: v.decideCancellation,
    description:
      'Approve (the load moves to Cancelled: open bids rejected, the memo withdrawn, the sourcing closed) or reject with a note (the load carries on). Refused if the load was Loaded while the request waited.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/bids/{bidId}/counter-response`,
    op: 'loadsmart.answerShipperCounter',
    permissions: [LS_PLACEMENT],
    schema: v.answerShipperCounter,
    description:
      "Placement answers the shipper's counter on Loadsmart's bid. Accepted: the counter becomes Loadsmart's price — the margin rules apply again (a note under the minimum, never at a loss). Declined: the bid stays at its price.",
  },
  {
    method: 'get',
    path: `${OPS}/analytics`,
    op: 'loadsmart.analytics',
    permissions: [LS_MONEY_APPROVE, LS_SETTINGS_MANAGE],
    schema: v.analytics,
    description:
      'Analytics (S02) for [from, to) against the period before: posted, placed (% of posted), billed, gross margin vs the central margin, hours to place, on time; loads posted per day; funnel; median hours per team step and per stage; margin by lane; money position (receivables by age, days to collect, paid to carriers); top shippers.',
  },
  {
    method: 'get',
    path: `${OPS}/live-map`,
    op: 'loadsmart.liveMap',
    permissions: [LS_TRACKING, LS_MONEY_APPROVE, LS_SETTINGS_MANAGE],
    schema: v.liveMap,
    description:
      "Live map (T07): every live Loadsmart load (truck assigned to reached unloading) with its last position and ETA from the tracking service, and a status — moving, no signal (2 h), needs action (papers or POD waiting, no unloading details, running late). 'At a stop' needs a halt flag from tracking. Find by code, vehicle or driver mobile.",
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
    description:
      'Charges on a Loadsmart load, each with `paidWith` (advance: loading-side charges; balance: the rest) and a `proofUrl`.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/charges/decisions`,
    op: 'loads.decideCharges',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.decideCharges,
    description:
      'Approve, reject or query several charges Loadsmart raised in one go ("Approve charges of ₹4,850"). Applied in order; the first that fails stops the rest.',
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
    method: 'post',
    path: `${LOADS}/loads/{loadId}/invoice/generate`,
    op: 'loads.generateLoadsmartInvoice',
    schema: v.load,
    permissions: [PAYMENTS_MANAGE],
    description:
      "The shipper's own \"Generate invoice\" on a delivered Loadsmart load: issues Loadsmart's invoice with the same checks as Receivables (POD approved, no charge waiting, the shipper's GSTIN on file) and moves the load Delivered → Invoice generated, so the shipper can pay it.",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/invoice`,
    op: 'loads.getLoadsmartInvoice',
    schema: v.load,
    permissions: [PAYMENTS_MANAGE],
    description:
      "Loadsmart's invoice and its PDF, with `payTo` (Loadsmart's bank account and UPI from Settings), `openAmount`, `dueDate` and `creditDays`. Report a payment with POST /loads/{loadId}/payments/balance (with the UTR); Receivables matches it against the bank.",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/documents-bundle`,
    op: 'loads.documentsBundle',
    schema: v.load,
    description: 'Every document on the load with download URLs, the load memo and the payments.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/ls-charges/{chargeId}/admin-decision`,
    op: 'loadsmart.decideChargeAsAdmin',
    permissions: [LS_MONEY_APPROVE],
    schema: v.chargeAdminDecision,
    description:
      "Super Admin's decision on a charge the shipper approved (status pending_admin): approved or rejected (with a reason).",
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/partner-payments`,
    op: 'loadsmart.partnerPaymentsOfLoad',
    permissions: [LS_TRACKING, LS_PAYABLES, LS_MONEY_APPROVE],
    schema: v.load,
    description:
      "The load's carrier advance and balance: status, amounts, line items, decision reason, UTR and a `proofUrl` for the payment advice — what Tracking passes to the broker.",
  },
  {
    method: 'get',
    path: `${OPS}/notifications`,
    op: 'loadsmart.notifications',
    permissions: ANY_TEAM,
    schema: v.notifications,
    description:
      "The team member's own in-app notices (advance raised / decided / paid, charges waiting for Super Admin, e-way bill at risk, load assigned), with the unread count.",
  },
  {
    method: 'post',
    path: `${OPS}/notifications/read-all`,
    op: 'loadsmart.readAllNotifications',
    permissions: ANY_TEAM,
    description: "Marks all of the member's notices read.",
  },
  {
    method: 'post',
    path: `${OPS}/notifications/{notificationId}/read`,
    op: 'loadsmart.readNotification',
    permissions: ANY_TEAM,
    schema: v.notification,
    description: 'Marks one notice read.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/claim`,
    op: 'loadsmart.claimPlacement',
    permissions: [LS_PLACEMENT],
    schema: v.moveOwnerParams,
    description: 'A Placement member takes a load nobody owns. 409 when it is already owned.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/tracking/claim`,
    op: 'loadsmart.claimTracking',
    permissions: [LS_TRACKING],
    schema: v.load,
    description:
      '"Claim this load as mine": a Tracking member takes a load nobody runs yet. 409 when owned.',
  },
  {
    method: 'get',
    path: `${OPS}/tracking/inbox`,
    op: 'loadsmart.trackingInbox',
    permissions: [LS_TRACKING],
    schema: v.trackingInbox,
    description:
      "Tracking's dashboard: loads on the road, the same table as All loads, with owners. `mine` and `unclaimed` narrow it; counts give all / mine / unclaimed. Carrier money only, no margin.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/calls`,
    op: 'loadsmart.logCall',
    permissions: [LS_TRACKING],
    schema: v.logCall,
    description:
      "Logs a call about the load. It can carry the truck's current location and its ETA to the loading (or unloading) point; with SIM/GPS tracking on and no location given, the tracking service's fresh position is used.",
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}/calls`,
    op: 'loadsmart.listCalls',
    permissions: ANY_TEAM,
    schema: v.listCalls,
    description: "The load's call log, newest first.",
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/documents`,
    op: 'loadsmart.uploadPapers',
    permissions: [LS_TRACKING],
    schema: v.uploadPapers,
    description:
      "Tracking attaches the invoice, e-way bill (with `ewayBillExpiresAt`) and signed LR when the shipper hasn't. A copy the shipper or driver already uploaded is never replaced (409 — review it instead). Tracking's own copies are approved as they are attached and show to the shipper as `referenceOnly` until the shipper uploads its own.",
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/details`,
    op: 'loadsmart.editLoadDetails',
    permissions: [LS_TRACKING],
    schema: v.editLoadDetails,
    description:
      "Edits a load on Tracking's desk: the reporting time (pickupAt, on the hour or half hour) and the pickup / drop area (address line, locality, PIN, coordinates). The city and state stay. Same stage limits as the shipper's edit after a truck is awarded.",
  },
  {
    method: 'patch',
    path: `${OPS}/loads/{loadId}/pod`,
    op: 'loadsmart.uploadPod',
    permissions: [LS_TRACKING],
    schema: v.uploadPod,
    description:
      'Records a POD Loadsmart captured itself (front, optional back) with the outcome: delivered_ok, or delivered_with_issues with an issueType (damage, shortage, pilferage) and a remark. No approval step; a driver-app POD still waits for POST /pod/decision.',
  },
  {
    method: 'get',
    path: `${OPS}/documents`,
    op: 'loadsmart.documentsPage',
    permissions: ANY_TEAM,
    schema: v.documentsPage,
    description:
      'Documents of every Loadsmart load, each with a view/download link. Search `q` by load code, LR / e-LR or invoice number; `series` by e-LR prefix (e.g. LSLR).',
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
