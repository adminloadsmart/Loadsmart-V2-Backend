import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { loadingPointValidators } from './loading-point.validators';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  SuccessResponseSchema,
  errorContent,
  json,
} from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/masters`; // absolute path — must match its mount in app.ts
const write = (description: string) => permissionGated([MASTERS_WRITE], description);
const approve = (description: string) => permissionGated([MASTERS_APPROVE], description);

export function registerLoadingPointOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/loading-points/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importLoadingPointsExcel',
    ...write('Bulk import loading points from an Excel file.'),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Excel file (.xlsx), maximum 5 MB.',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import report with created and failed row counts' },
      400: { description: 'Invalid Excel file or missing file', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loading-points`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createLoadingPoint',
    ...write(
      'Create a loading point (warehouse/factory origin). New records start pending and need org_admin approval before they go live.',
    ),
    request: { body: json(loadingPointValidators.create.shape.body) },
    responses: {
      201: { description: 'Created loading point' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listLoadingPoints',
    ...authenticated('List loading points for the tenant, paginated and optionally filtered.'),
    request: { query: loadingPointValidators.list.shape.query },
    responses: {
      200: {
        description:
          'Paginated loading points — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points/cities`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listLoadingPointCities',
    ...authenticated(
      'Distinct cities with at least one loading point — feeds a city filter dropdown.',
    ),
    request: { query: loadingPointValidators.listCities.shape.query },
    responses: { 200: { description: 'Sorted list of distinct city names' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getLoadingPoint',
    ...authenticated('Get a single loading point, including full address and contact details.'),
    request: { params: loadingPointValidators.get.shape.params },
    responses: {
      200: { description: 'Loading point detail' },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateLoadingPoint',
    ...write('Update one or more fields on a loading point.'),
    request: {
      params: loadingPointValidators.update.shape.params,
      body: json(loadingPointValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated loading point' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveLoadingPoint',
    ...approve('Approve a pending loading point. org_admin only.'),
    request: { params: loadingPointValidators.approve.shape.params },
    responses: {
      200: { description: 'Approved loading point' },
      404: { description: 'Loading point not found', ...errorContent },
      409: { description: 'Loading point is not pending', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectLoadingPoint',
    ...approve('Reject a pending loading point with a mandatory reason. org_admin only.'),
    request: {
      params: loadingPointValidators.reject.shape.params,
      body: json(loadingPointValidators.reject.shape.body),
    },
    responses: {
      200: { description: 'Rejected loading point' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Loading point not found', ...errorContent },
      409: { description: 'Loading point is not pending', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteLoadingPoint',
    ...write('Soft-delete a loading point.'),
    request: { params: loadingPointValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });
}
