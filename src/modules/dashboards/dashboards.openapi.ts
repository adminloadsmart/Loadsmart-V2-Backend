import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { dashboardsValidators } from './dashboards.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { CUSTOMERS_APPROVE, MASTERS_APPROVE } from '../../shared/constants/permissions';
import { TAGS, authenticated, permissionGated, errorContent } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the dashboards module: registers every route in dashboards.routes.ts, in the
 * same order, under the `dashboards` tag. See masters.openapi.ts for the pattern this follows.
 */

const BASE = `${API_VERSION_PREFIX}/dashboards`; // absolute path — must match its mount in app.ts

export function registerDashboardsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/fleet-activity`,
    tags: [TAGS.DASHBOARDS],
    operationId: 'dashboards.getFleetActivity',
    ...authenticated(
      'Fleet activity summary for the tenant over a date range (defaults to the last 15 days). ' +
        'kmCovered, maintenanceCost, and fleetPnl are always null today — tracking, maintenance, ' +
        'and payments have no dated distance/cost/earning records yet to aggregate.',
    ),
    request: { query: dashboardsValidators.getFleetActivity.shape.query },
    responses: {
      200: { description: 'Fleet activity summary' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/pending-approvals`,
    tags: [TAGS.DASHBOARDS],
    operationId: 'dashboards.listPendingApprovals',
    ...permissionGated(
      [CUSTOMERS_APPROVE, MASTERS_APPROVE],
      'Settings → Approvals: every pending customer, vehicle, and driver for the tenant in one ' +
        'list, newest first. Read-only — approve/reject each item on its own endpoint ' +
        '(PATCH /customers/{id}/approve|reject, PATCH /masters/vehicles|drivers/{id}/approve|reject).',
    ),
    responses: {
      200: { description: 'Pending approvals — { data: { items, total } }' },
    },
  });
}
