import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { DISPATCH_PLANNING_MANAGE } from '../../../shared/constants/permissions';
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
        'Allowed from 30 minutes after the load was sent until bidding closes 4 hours after it; ' +
        '`reason` is required and logged with the shipper’s name. The transporter must be ' +
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
    path: `${BASE}/loads/{loadId}/indent/accept`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordIndentAcceptance',
    ...manageDispatch(
      'The contracted transporter accepted the indent and sent the truck number. Records it as ' +
        'the indent’s one bid, at the contract rate — that is the award: the load moves to Bids ' +
        'received on the indent route. No separate confirmation; the load memo follows.',
    ),
    request: {
      params: v.recordIndentAcceptance.shape.params,
      body: json(v.recordIndentAcceptance.shape.body),
    },
    responses: {
      201: { description: 'The bid' },
      409: { description: 'Not an indent, or already accepted', ...errorContent },
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
        'otherwise `memo` is null and `checks` lists the failures to fix.',
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
    responses: { 200: { description: '{ truck, driver, clear }' } },
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
      'The contracted transporter rejected the indent (`reason`). The load goes to the open ' +
        'market at Created: it becomes a market load, the contract rate stays as the expected ' +
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
