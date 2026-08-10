import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { dashboardsValidators } from './dashboards.validators';
import { TAGS, authenticated, errorContent } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the dashboards module: registers every route in dashboards.routes.ts, in the
 * same order, under the `dashboards` tag. See masters.openapi.ts for the pattern this follows.
 */

const BASE = '/dashboards'; // absolute path — must match its mount in composition-root.ts

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
}
