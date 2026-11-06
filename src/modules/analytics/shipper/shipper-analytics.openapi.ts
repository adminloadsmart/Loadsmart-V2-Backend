import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../../shared/openapi/core';
import { shipperAnalyticsValidators as validators } from './shipper-analytics.validators';

const BASE = `${API_VERSION_PREFIX}/analytics/shipper`;

const NOTE =
  'Calculated per the Shipper Analytics Metric Guide v1.0. Money and volume count loads by loading ' +
  'date, service by delivery date; every tile compares with the previous period of equal length. ' +
  'A figure whose source is not recorded yet is null and named under meta.unavailable.';

const ENDPOINTS = [
  {
    path: 'filters',
    id: 'getShipperFilters',
    summary: 'Filter options that have loads in the period',
    schema: validators.getFilters,
  },
  {
    path: 'overview',
    id: 'getShipperOverview',
    summary: 'Overview tab (§7)',
    schema: validators.getOverview,
  },
  {
    path: 'freight-spend',
    id: 'getShipperFreightSpend',
    summary: 'Freight Spend tab (§8)',
    schema: validators.getFreightSpend,
  },
  {
    path: 'transporters',
    id: 'getShipperTransporters',
    summary: 'Transporters tab (§9)',
    schema: validators.getTransporters,
  },
  {
    path: 'service',
    id: 'getShipperService',
    summary: 'Service tab (§10)',
    schema: validators.getService,
  },
  {
    path: 'billing',
    id: 'getShipperBilling',
    summary: 'Billing tab (§11)',
    schema: validators.getBilling,
  },
] as const;

export function registerShipperAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  for (const endpoint of ENDPOINTS) {
    registry.registerPath({
      method: 'get',
      path: `${BASE}/${endpoint.path}`,
      tags: [TAGS.ANALYTICS],
      operationId: `analytics.${endpoint.id}`,
      ...authenticated(`${endpoint.summary}. ${NOTE}`),
      request: { query: endpoint.schema.shape.query as never },
      responses: {
        200: { description: endpoint.summary },
        400: { description: 'Invalid request', ...errorContent },
        401: { description: 'Authentication required', ...errorContent },
      },
    });
  }
}
