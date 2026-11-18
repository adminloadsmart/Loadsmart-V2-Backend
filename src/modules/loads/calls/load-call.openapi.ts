import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { LOADSMART_TEAM_PERMISSIONS } from '../../../shared/constants/loadsmart-teams';
import { TAGS, authenticated, json, permissionGated } from '../../../shared/openapi/core';
import { loadCallValidators as v } from './load-call.validators';

/** OpenAPI docs for load-call.routes.ts — Log a call (load module spec p.36). */
export function registerLoadCallOpenApi(registry: OpenAPIRegistry): void {
  const shipper = `${API_VERSION_PREFIX}/loads`;
  const ops = `${API_VERSION_PREFIX}/loadsmart-ops`;
  const anyTeam = (description: string) =>
    permissionGated([...LOADSMART_TEAM_PERMISSIONS], description);
  const callView =
    '{ id, loadId, team, calledBy {id, name}, parties[{role, name?, phone?}], notes, outcome, price, reminderAt, reminderDoneAt, createdAt }';

  registry.registerPath({
    method: 'get',
    path: `${shipper}/loads/{loadId}/calls`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listCalls',
    ...authenticated(
      "Calls the shipper's own team logged on this load, newest first. Loadsmart's internal calls are not shown.",
    ),
    request: { params: v.listCalls.shape.params },
    responses: {
      200: { description: `[${callView}]` },
      404: { description: "Not this tenant's load" },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${shipper}/loads/{loadId}/calls`,
    tags: [TAGS.LOADS],
    operationId: 'loads.logCall',
    ...authenticated(
      'Log a call: who was spoken to (one or more of shipper, driver, broker, shipper_sales, ' +
        'trucker_sales), what was discussed, the outcome (not_picked_up / picked_up / price — price ' +
        'needs `price`) and an optional future reminder, which arrives as a call.reminder ' +
        'notification. Noted on the load timeline as CALL_LOGGED.',
    ),
    request: { params: v.logShipperCall.shape.params, body: json(v.logShipperCall.shape.body) },
    responses: {
      201: { description: callView },
      400: { description: 'Missing price, or a reminder in the past' },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${shipper}/calls/reminders`,
    tags: [TAGS.LOADS],
    operationId: 'loads.myCallReminders',
    ...authenticated(
      "The signed-in user's open call reminders, soonest first, with `isDue` and the load code.",
    ),
    responses: { 200: { description: `[${callView} + loadCode, isDue]` } },
  });
  registry.registerPath({
    method: 'post',
    path: `${shipper}/calls/{callId}/reminder-done`,
    tags: [TAGS.LOADS],
    operationId: 'loads.closeCallReminder',
    ...authenticated('Close one of your own call reminders.'),
    request: { params: v.reminderDone.shape.params },
    responses: { 200: { description: callView }, 404: { description: 'Not your call' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${ops}/loads/{loadId}/load-calls`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.listCalls',
    ...anyTeam('Every call logged on this load by any team (the call log), newest first.'),
    request: { params: v.listCalls.shape.params },
    responses: { 200: { description: `[${callView}]` } },
  });
  registry.registerPath({
    method: 'post',
    path: `${ops}/loads/{loadId}/load-calls`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.logCall',
    ...anyTeam(
      "Log a call as one of Loadsmart's teams (`team`). Same form as the shipper's; the reminder " +
        "shows in the caller's reminders queue (Loadsmart's teams have no tenant inbox).",
    ),
    request: { params: v.logLoadsmartCall.shape.params, body: json(v.logLoadsmartCall.shape.body) },
    responses: { 201: { description: callView } },
  });
  registry.registerPath({
    method: 'get',
    path: `${ops}/load-calls/reminders`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.myCallReminders',
    ...anyTeam("The signed-in team member's open call reminders, soonest first (`isDue`)."),
    responses: { 200: { description: `[${callView} + loadCode, isDue]` } },
  });
  registry.registerPath({
    method: 'post',
    path: `${ops}/load-calls/{callId}/reminder-done`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.closeCallReminder',
    ...anyTeam('Close one of your own call reminders.'),
    request: { params: v.reminderDone.shape.params },
    responses: { 200: { description: callView } },
  });
}
