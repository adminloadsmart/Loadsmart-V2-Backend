import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/analytics`;

export function registerAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/shipper/overview`,
    tags: [TAGS.ANALYTICS],
    operationId: 'analytics.getShipperOverview',
    ...authenticated(
      'All-time shipper analytics for the tenant: moved loads, tonnage, tonnage by product, and lane performance. ' +
        'Freight/spend metrics are intentionally excluded. avgKm is null because route distance is not stored.',
    ),
    responses: {
      200: { description: 'All-time shipper analytics overview' },
      400: { description: 'Invalid request', ...errorContent },
      401: { description: 'Authentication required', ...errorContent },
    },
  });
}
