import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  DISPATCH_PLANNING_MANAGE,
  TRUCK_VERIFY_MANUAL,
  DRIVER_VERIFY_MANUAL,
} from '../../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  errorContent,
  json,
} from '../../../shared/openapi/core';
import { loadSourcingValidators as v } from './load-sourcing.validators';

/** OpenAPI docs for load-sourcing.routes.ts — bids, indent acceptance, driver and load memo. */

const BASE = `${API_VERSION_PREFIX}/loads`; // same mount as loads.openapi.ts
const manageDispatch = (description: string) =>
  permissionGated([DISPATCH_PLANNING_MANAGE], description);

export function registerLoadSourcingOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/bids`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listBids',
    ...authenticated(
      "The load's bids — live bids ranked best first (a bid that can be accepted, then the " +
        'lowest rate, then the earliest), followed by accepted/rejected/expired ones. A bid with ' +
        'no truck number, or whose truck failed its check, is listed with `canAccept: false` and ' +
        'the reason in `acceptBlocker`. Bids expire 4 hours after the load was sent ' +
        '(`biddingClosesAt`); expiry is applied on read.',
    ),
    request: { params: v.listBids.shape.params },
    responses: { 200: { description: '{ loadId, loadStatus, biddingClosesAt, bids[] }' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bids`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordBid',
    ...manageDispatch(
      'Record a rate one of the shipper’s own transporters gave by phone, on a market load. ' +
        'Allowed until bidding closes 4 hours after the load was sent; ' +
        '`reason` is optional; the shipper’s name is logged. The transporter must be ' +
        'one the posting went to. Quoting again revises the transporter’s live bid. The ' +
        'first bid moves the load to Bids received.',
    ),
    request: { params: v.recordBid.shape.params, body: json(v.recordBid.shape.body) },
    responses: {
      201: { description: 'The bid' },
      409: {
        description:
          'Too early or bidding closed, not a market load, truck already assigned, transporter ' +
          'not sent this load, or the truck is on another live load',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/bids/{bidId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.setBidTruck',
    ...manageDispatch('Add or change the truck number on a live bid ("no truck number, no bid").'),
    request: { params: v.setBidTruck.shape.params, body: json(v.setBidTruck.shape.body) },
    responses: {
      200: { description: 'The bid' },
      409: { description: 'The bid is no longer live, or the truck is busy', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bids/{bidId}/accept`,
    tags: [TAGS.LOADS],
    operationId: 'loads.acceptBid',
    ...manageDispatch(
      'Award a bid at Bids received: the load keeps its stage with the award on it — the ' +
        'bid’s transporter, truck and rate (route own_transporter; Loadsmart’s bid becomes a ' +
        'Loadsmart load when its memo is accepted). The other live bids are rejected. One ' +
        'accepted bid per load. Only a live bid with a truck number whose truck has not failed ' +
        'its check can be accepted.',
    ),
    request: { params: v.acceptBid.shape.params },
    responses: {
      200: { description: 'The updated load' },
      409: {
        description: 'Expired, no truck number, failed truck check, or not in Bids received',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bids/{bidId}/counter`,
    tags: [TAGS.LOADS],
    operationId: 'loads.counterBid',
    ...manageDispatch(
      'Counter a live bid with your own rate (and a note). The bid waits for the answer — Accept ' +
        'stays off until it is recorded; a new counter replaces one still waiting. A counter on ' +
        "Loadsmart's bid goes to Loadsmart's Placement team, which answers on its console.",
    ),
    request: { params: v.counterBid.shape.params, body: json(v.counterBid.shape.body) },
    responses: {
      200: { description: 'The bid, with its counter and rate history' },
      409: { description: 'Not a live bid, or a bid is already accepted', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bids/{bidId}/counter-response`,
    tags: [TAGS.LOADS],
    operationId: 'loads.answerCounter',
    ...manageDispatch(
      "Record the transporter's answer to your counter, given by phone. Accepted: the counter " +
        "becomes the bid's rate. Not for Loadsmart's bid — Loadsmart answers that itself.",
    ),
    request: { params: v.answerCounter.shape.params, body: json(v.answerCounter.shape.body) },
    responses: {
      200: { description: 'The bid' },
      409: { description: 'No counter waiting, or a Loadsmart bid', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bids/{bidId}/reject`,
    tags: [TAGS.LOADS],
    operationId: 'loads.rejectBid',
    ...manageDispatch(
      "Reject a live bid, with an optional reason. Rejecting Loadsmart's bid lets its Placement " +
        'team send another.',
    ),
    request: { params: v.rejectBid.shape.params, body: json(v.rejectBid.shape.body) },
    responses: {
      200: { description: 'The rejected bid' },
      409: { description: 'Not a live bid, or a bid is already accepted', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/indent/accept`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordIndentAcceptance',
    ...manageDispatch(
      '"Transporter accepted" — the shipper enters an indent transporter’s acceptance given by ' +
        'phone. `transporterId` must be a transporter the indent was offered to (today its ' +
        'contracted transporter). `reason` is optional; the ' +
        'shipper’s name is logged. Without `vehicleNumber` the acceptance is only noted ' +
        '(`waitingFor: "truck"`, the load stays at Created) and WhatsApp asks that transporter ' +
        'for the truck. With it, it is the award to that transporter at the contract rate: the ' +
        'load moves to Bids received on the indent route and the driver and memo follow.',
    ),
    request: {
      params: v.recordIndentAcceptance.shape.params,
      body: json(v.recordIndentAcceptance.shape.body),
    },
    responses: {
      201: { description: '{ loadId, transporterId, loadStatus, waitingFor, bid }' },
      409: {
        description:
          'Not an indent, already accepted, not offered to that transporter, or already noted ' +
          'as accepted without a truck',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/driver`,
    tags: [TAGS.LOADS],
    operationId: 'loads.nameDriver',
    ...manageDispatch(
      'The transporter names the driver (name, mobile, licence number and date of birth) for a ' +
        'market or indent load with an award, at Bids received. The truck is checked on VAHAN if it never was, ' +
        'and the licence on Sarathi. The memo (expires in 1 hour) goes only when no check failed; ' +
        'otherwise `memo` is null and `checks` lists the failures to fix. The driver is named for ' +
        'whoever the load is awarded to. On an indent not awarded yet (still Created), ' +
        '`vehicleNumber` is required and awards it to the indent’s transporter first, in the ' +
        'same call. `reason` (optional) is logged with the shipper’s name.',
    ),
    request: { params: v.nameDriver.shape.params, body: json(v.nameDriver.shape.body) },
    responses: {
      201: { description: '{ memo, checks } — memo sent' },
      200: { description: '{ memo: null, checks } — a check failed, no memo sent' },
      409: {
        description: 'Own fleet, no award yet, or memo already accepted',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/verifications`,
    tags: [TAGS.LOADS],
    operationId: 'loads.getVerifications',
    ...authenticated(
      'The latest govt-portal checks on the load: the truck on VAHAN (RC, fitness, insurance, ' +
        'PUC, permit) and the driver on Sarathi (found, in date, and the licence class covers the ' +
        'truck — above 7.5 t GVW a transport licence). Each shows only its `failures`; ' +
        '`unavailable` means the portal could not be reached. `clear` (both passed) is what the ' +
        'load memo waits on; `blockers` says why not — a failed check, one not run yet, or one ' +
        'that could not run (POST /loads/{loadId}/verifications/rerun).',
    ),
    request: { params: v.getChecks.shape.params },
    responses: {
      200: {
        description: '{ truck, driver, clear, blockers, truckManualAllowed, driverManualAllowed }',
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/verifications/rerun`,
    tags: [TAGS.LOADS],
    operationId: 'loads.rerunChecks',
    ...manageDispatch(
      'Run the truck (VAHAN) and driver (Sarathi) checks again — after a portal could not be ' +
        'reached, or a paper was fixed. If both then pass, the driver is named and no memo is ' +
        'open, the memo goes out (201 with `memo`). Not on Loadsmart loads (Placement runs them).',
    ),
    request: { params: v.rerunChecks.shape.params },
    responses: {
      200: { description: '{ memo: null, checks } — still blocked' },
      201: { description: '{ memo, checks } — memo sent' },
      409: { description: 'No award yet, own fleet, or memo already accepted', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/verifications/truck/manual`,
    tags: [TAGS.LOADS],
    operationId: 'loads.verifyTruckManually',
    ...permissionGated(
      [TRUCK_VERIFY_MANUAL],
      "VAHAN couldn't be reached for the load's truck (its latest check is `unavailable`, see " +
        '`truckManualAllowed` on GET /verifications), so an org admin checks the RC by hand. ' +
        'Any paper expiry dates entered are still checked — an expired one fails it. Saved with ' +
        "`source: 'manual'` and `verifiedBy`; a later rerun keeps it. If every check then passes, " +
        'the memo goes out (201). A VAHAN pass or failure cannot be overridden. Not on Loadsmart ' +
        'loads (the Admin team does it from the console).',
    ),
    request: {
      params: v.verifyTruckManually.shape.params,
      body: json(v.verifyTruckManually.shape.body),
    },
    responses: {
      200: { description: '{ memo: null, checks } — still blocked' },
      201: { description: '{ memo, checks } — memo sent' },
      409: {
        description: 'Check not unavailable, Loadsmart load, own fleet, or no award',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/verifications/driver/manual`,
    tags: [TAGS.LOADS],
    operationId: 'loads.verifyDriverManually',
    ...permissionGated(
      [DRIVER_VERIFY_MANUAL],
      "Sarathi couldn't confirm the driver's licence — it wasn't reachable, or found no match " +
        '(`driverManualAllowed` on GET /verifications) — so an org admin checks the licence by ' +
        'hand. A validity date entered is still checked (expired fails it); the licence class is ' +
        "not. Saved with `source: 'manual'` and `verifiedBy`; a later rerun keeps it. If every " +
        'check then passes, the memo goes out (201). An expired licence or the wrong class on ' +
        'Sarathi cannot be overridden. Not on Loadsmart loads.',
    ),
    request: {
      params: v.verifyDriverManually.shape.params,
      body: json(v.verifyDriverManually.shape.body),
    },
    responses: {
      200: { description: '{ memo: null, checks } — still blocked' },
      201: { description: '{ memo, checks } — memo sent' },
      409: {
        description: 'Sarathi verdict, no driver yet, Loadsmart load, own fleet, or no award',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/memos`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listMemos',
    ...authenticated(
      'Every load memo version, latest first — reference (LM-<load>-v<n>), truck, driver, ' +
        'licence, freight and payment terms, `pdfFileKey`, status (sent / accepted / expired / ' +
        'superseded) and, once accepted, who and how (`acceptedVia` app or call).',
    ),
    request: { params: v.listMemos.shape.params },
    responses: { 200: { description: 'MemoView[]' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/truck-cancellation`,
    tags: [TAGS.LOADS],
    operationId: 'loads.cancelTruck',
    ...manageDispatch(
      'The truck was cancelled between Truck assigned and Loaded (own transporter / indent). ' +
        '`reasonCode` is an active code from Settings. `next`: `new_truck` — back to Bids ' +
        'received with the award kept, for a new truck, driver, checks and memo version; ' +
        '`reopen` — back to Created with no winner (an indent keeps its contracted transporter). ' +
        'The truck and driver come off the load and are kept with the cancellation.',
    ),
    request: { params: v.cancelTruck.shape.params, body: json(v.cancelTruck.shape.body) },
    responses: {
      200: { description: 'The load, back at Bids received or Created' },
      400: { description: 'Not an active reason code', ...errorContent },
      409: {
        description: 'Not between Truck assigned and Loaded, or not this route',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/cancellation`,
    tags: [TAGS.LOADS],
    operationId: 'loads.cancellationOptions',
    ...authenticated(
      'What the cancel form needs: `canCancel` and `blocker`, `needsLoadsmartApproval` (a load ' +
        'Loadsmart has won waits for Super Admin), the request `pending`, the `latest` one with ' +
        'its decision, `cancelledAt` / `cancelledFromStage`, and the active `reasonCodes` (code, ' +
        'label) — the same list a truck cancellation uses.',
    ),
    request: { params: v.listTruckCancellations.shape.params },
    responses: { 200: { description: 'Cancellation options' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/bid-window/extend`,
    tags: [TAGS.LOADS],
    operationId: 'loads.extendBidWindow',
    ...manageDispatch(
      '"Extend" on a market load still taking bids (Created or Bids received, nothing accepted): ' +
        'the bid window restarts and closes 4 hours from now — a closed window reopens. A window ' +
        'Loadsmart Placement already pushed later is kept. Returns the bid list with the new ' +
        '`biddingClosesAt`.',
    ),
    request: { params: v.extendBidWindow.shape.params },
    responses: {
      200: { description: 'LoadBidsView — { loadId, loadStatus, biddingClosesAt, bids }' },
      404: { description: 'Load or posting not found', ...errorContent },
      409: {
        description: 'Not a market load, no posting, or a bid is already accepted',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/withdraw`,
    tags: [TAGS.LOADS],
    operationId: 'loads.withdrawLoad',
    ...manageDispatch(
      '"Withdraw load" — allowed only until the load memo is accepted (Created or Bids ' +
        'received); after that, cancel the load instead. The same write as a cancellation: open ' +
        'bids rejected, an open memo withdrawn; a load Loadsmart has won waits for Super Admin ' +
        '(outcome `pending`). `reasonCode` defaults to `shipper_cancelled`.',
    ),
    request: { params: v.withdrawLoad.shape.params, body: json(v.withdrawLoad.shape.body) },
    responses: {
      200: { description: '{ outcome, load, cancellation }' },
      400: { description: 'Not an active reason code', ...errorContent },
      409: {
        description: 'The memo is already accepted, the load is cancelled, or a request is waiting',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/cancel`,
    tags: [TAGS.LOADS],
    operationId: 'loads.cancelLoad',
    ...manageDispatch(
      'Cancel the whole load, any time before Loaded, with an active reason code from Settings. ' +
        'Own transporter, indent, own fleet and market loads nobody has won: cancelled at once ' +
        '(outcome `cancelled`) — open bids are rejected, an open memo withdrawn, an own-fleet truck ' +
        'freed. A load Loadsmart has won: a request Super Admin approves or rejects on the ops ' +
        'console (outcome `pending`). Cancelled loads sit outside the 13 stages, in the ' +
        '`cancelled` status group.',
    ),
    request: { params: v.cancelLoad.shape.params, body: json(v.cancelLoad.shape.body) },
    responses: {
      200: { description: '{ outcome, load, cancellation }' },
      400: { description: 'Not an active reason code', ...errorContent },
      409: {
        description: 'Already Loaded or cancelled, or a request is already waiting',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/truck-cancellations`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listTruckCancellations',
    ...authenticated(
      'The truck cancellations on the load, latest first, with the cancelled truck.',
    ),
    request: { params: v.listTruckCancellations.shape.params },
    responses: { 200: { description: 'LoadCancellation[]' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/indent/reject`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordIndentRejection',
    ...manageDispatch(
      'An indent transporter rejected it (`transporterId`, `reason`) — the transporter must be ' +
        'one the indent was offered to. Once no other indent transporter can take it the load ' +
        'goes to the open market at Created: it becomes a market load, the contract rate stays as the expected ' +
        'price, the shipper’s active transporters become recipients and Loadsmart opens its ' +
        'sourcing. The contract’s non-placement penalty, if any, is recorded with the change.',
    ),
    request: {
      params: v.recordIndentRejection.shape.params,
      body: json(v.recordIndentRejection.shape.body),
    },
    responses: {
      200: { description: 'The load, now a market load' },
      409: { description: 'Not an indent, or already accepted', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/memo`,
    tags: [TAGS.LOADS],
    operationId: 'loads.getMemo',
    ...authenticated(
      "The load's latest memo — truck, driver, loading contact, and `status` " +
        '(sent / accepted / expired; a sent memo past its hour reads expired).',
    ),
    request: { params: v.getMemo.shape.params },
    responses: {
      200: { description: 'The load memo' },
      404: { description: 'No memo sent yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/memo`,
    tags: [TAGS.LOADS],
    operationId: 'loads.resendMemo',
    ...manageDispatch(
      'Send a fresh load memo for the current truck and driver, e.g. after expiry.',
    ),
    request: { params: v.resendMemo.shape.params },
    responses: {
      201: { description: 'The new load memo' },
      409: {
        description: 'No driver named, a truck/driver check failed, or memo already accepted',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/memo/accept`,
    tags: [TAGS.LOADS],
    operationId: 'loads.acceptMemo',
    ...manageDispatch(
      'The shipper accepts the load memo before it expires, optionally changing the loading ' +
        'contact or adding a loading point note. This moves the load to Truck assigned (on a ' +
        'Loadsmart award, it becomes a Loadsmart load).',
    ),
    request: { params: v.acceptMemo.shape.params, body: json(v.acceptMemo.shape.body) },
    responses: {
      200: { description: 'The accepted memo' },
      409: { description: 'Expired, already accepted, or none sent', ...errorContent },
    },
  });
}
