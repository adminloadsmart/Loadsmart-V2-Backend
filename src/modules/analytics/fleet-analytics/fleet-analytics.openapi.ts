import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { authenticated, errorContent, TAGS } from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/fleet-analytics`;

export function registerFleetAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/fleet/overview`,
    tags: [TAGS.ANALYTICS],
    operationId: 'fleetAnalytics.getOverview',
    ...authenticated(
      'Fleet Analytics overview: emiSummary (current EMI outgo + vehicles on finance, not ' +
        'date-scoped) and sourceMix (own-fleet vs market load counts, optionally windowed by ' +
        '`from`/`to` — createdAt, either or both may be omitted for all-time counts).',
    ),
    request: { query: fleetAnalyticsValidators.getOverview.shape.query },
    responses: {
      200: {
        description:
          '{ emiSummary: { totalEmiAmount, vehiclesOnFinance }, sourceMix: { ownFleet, market } }',
      },
      400: { description: 'Validation failed', ...errorContent },
    },
  });
}
