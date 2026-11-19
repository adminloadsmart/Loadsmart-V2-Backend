import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, permissionGated } from '../../../shared/openapi/core';
import { brokerValidators as v } from './broker.validators';
import { BROKER_VIEW_PERMISSIONS } from './broker.permissions';

/** OpenAPI docs for broker.routes.ts — the Brokers page. */
export function registerBrokerOpenApi(registry: OpenAPIRegistry): void {
  const ops = `${API_VERSION_PREFIX}/loadsmart-ops`;
  const brokerView =
    '{ id, brokerName, contactName, phone, isOnWhatsapp, email, base, truckSources[], ' +
    'lane {origin, destinations[], label}, tdsPercent, loadsLast30Days, rating, status, holdReason, pendingOriginalPods }';

  registry.registerPath({
    method: 'get',
    path: `${ops}/brokers`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.listBrokers',
    ...permissionGated(
      [...BROKER_VIEW_PERMISSIONS],
      'The broker list, firm name A–Z. `status` picks the tab (approved / awaiting_approval / ' +
        'on_hold / rejected; omit for All); `search` matches broker name, contact, phone, base or ' +
        'lane. `summary` (the cards) and `tabs` (the tab counts) cover every broker, not the filter.',
    ),
    request: { query: v.listBrokers.shape.query },
    responses: {
      200: {
        description:
          `{ items: [${brokerView}], page, limit, total, totalPages, ` +
          'summary { approved {count, placedLoadLast30Days}, awaitingApproval {count}, onHold {count}, ' +
          'originalPodsPast15Days {count, brokers}, onWhatsapp {count, notOnWhatsapp} }, ' +
          'tabs { all, approved, awaiting_approval, on_hold, rejected } }',
      },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${ops}/brokers/export`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.exportBrokers',
    ...permissionGated(
      [...BROKER_VIEW_PERMISSIONS],
      'Export CSV: every broker matching `status` and `search` (not paged), as a text/csv download.',
    ),
    request: { query: v.exportBrokers.shape.query },
    responses: { 200: { description: 'text/csv' } },
  });
}
