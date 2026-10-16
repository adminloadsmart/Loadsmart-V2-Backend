import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated } from '../../../shared/openapi/core';

export function registerMastersSummaryOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${API_VERSION_PREFIX}/masters/summary`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.summary',
    ...authenticated(
      'Settings → Masters cards: record counts for customers (excluding rejected), transporters, ' +
        'loading points, products and contracts, plus `alerts.customersWithoutVerifiedGstOrTerms` ' +
        '(active/pending customers with no verified GSTIN or no credit days).',
    ),
    responses: { 200: { description: 'Counts' } },
  });
}
