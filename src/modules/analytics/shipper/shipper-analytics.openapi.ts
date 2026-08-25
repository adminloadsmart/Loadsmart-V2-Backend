import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../../shared/openapi/core';
import { shipperAnalyticsValidators } from './shipper-analytics.validators';

const BASE = `${API_VERSION_PREFIX}/analytics`;

export function registerShipperAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/shipper/overview`,
    tags: [TAGS.ANALYTICS],
    operationId: 'analytics.getShipperOverview',
    ...authenticated(
      'All-time shipper analytics for the tenant: moved loads, tonnage, tonnage by product, and lane performance. ' +
        'Optional from/to filters use the load creation date. Freight/spend metrics are intentionally excluded. ' +
        'avgKm is null because route distance is not stored.',
    ),
    request: { query: shipperAnalyticsValidators.getOverview.shape.query },
    responses: {
      200: { description: 'All-time shipper analytics overview' },
      400: { description: 'Invalid request', ...errorContent },
      401: { description: 'Authentication required', ...errorContent },
    },
  });
}
