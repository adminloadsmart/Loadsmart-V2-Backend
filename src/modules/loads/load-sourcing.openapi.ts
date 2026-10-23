import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { DISPATCH_PLANNING_MANAGE } from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  errorContent,
  json,
} from '../../shared/openapi/core';
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
      'Accept a bid: the load moves to Truck assigned with the bid’s transporter, truck ' +
        'and rate, and the load’s other live bids are rejected. Only a live bid with a ' +
        'truck number whose truck has not failed its check can be accepted. On an indent this ' +
        'confirms the truck at the contract rate — there is no counter offer.',
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
        'the indent’s one bid, at the contract rate, and moves the load to Bids received. ' +
        'The shipper then confirms it with POST /loads/{loadId}/bids/{bidId}/accept.',
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
      'The transporter names the driver (name and mobile) for a market or indent load at Truck ' +
        'assigned. Sends the shipper a fresh load memo that expires in 1 hour.',
    ),
    request: { params: v.nameDriver.shape.params, body: json(v.nameDriver.shape.body) },
    responses: {
      201: { description: 'The load memo' },
      409: {
        description: 'Own fleet, not at Truck assigned, or memo already accepted',
        ...errorContent,
      },
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
      409: { description: 'No driver named, or memo already accepted', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/memo/accept`,
    tags: [TAGS.LOADS],
    operationId: 'loads.acceptMemo',
    ...manageDispatch(
      'The shipper accepts the load memo within its hour, optionally changing the loading ' +
        'contact or adding a loading point note. The trip can start only after this.',
    ),
    request: { params: v.acceptMemo.shape.params, body: json(v.acceptMemo.shape.body) },
    responses: {
      200: { description: 'The accepted memo' },
      409: { description: 'Expired, already accepted, or none sent', ...errorContent },
    },
  });
}
