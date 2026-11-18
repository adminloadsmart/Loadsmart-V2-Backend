import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, permissionGated } from '../../../shared/openapi/core';
import { LOADSMART_TEAM_PERMISSIONS } from '../../../shared/constants/loadsmart-teams';
import { sentLogValidators as v } from './sent-log.validators';

/** OpenAPI docs for sent-log.routes.ts — the load's message log (tasks 3 and 4). */
export function registerSentLogOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${API_VERSION_PREFIX}/loads/loads/{loadId}/messages`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listMessages',
    ...authenticated(
      'Notifications sent about this load: recipient, channel, message, time, status. Shipper-safe: ' +
        "only the shipper's own team, receivers, drivers and (not on Loadsmart loads) their own " +
        "transporters; never Loadsmart's brokers, phone numbers, ids or vendor / provider names.",
    ),
    request: { params: v.loadMessages.shape.params },
    responses: {
      200: { description: '[{ recipient, recipientKind, channel, message, status, at }]' },
      404: { description: "Not this tenant's load" },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_VERSION_PREFIX}/loadsmart-ops/loads/{loadId}/messages`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.listLoadMessages',
    ...permissionGated(
      [...LOADSMART_TEAM_PERMISSIONS],
      'Every message about this load on every channel (WhatsApp, SMS, email, push, in-app), with ' +
        'address, provider, template, intent, status and why a channel was suppressed.',
    ),
    request: { params: v.loadMessages.shape.params },
    responses: { 200: { description: 'Message log rows, oldest first' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_VERSION_PREFIX}/loadsmart-ops/loads/{loadId}/whatsapp`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.whatsappLog',
    ...permissionGated(
      [...LOADSMART_TEAM_PERMISSIONS],
      "The load's WhatsApp log: each message with its template, sent / delivered / read / failed " +
        'times and the replies to it (button taps, typed values, list picks, with how each was ' +
        'routed and resolved); replies matched to no message are in `otherReplies`.',
    ),
    request: { params: v.loadMessages.shape.params },
    responses: { 200: { description: '{ messages[], otherReplies[] }' } },
  });
}
