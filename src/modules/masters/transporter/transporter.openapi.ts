import { registerImportSampleOpenApi } from '../../../shared/import/openapi';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { transporterValidators } from './transporter.validators';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
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

export function registerTransporterOpenApi(registry: OpenAPIRegistry): void {
  registerImportSampleOpenApi(registry, {
    path: `${BASE}/transporters/import/sample`,
    operationId: 'masters.transporterImportSample',
    permission: MASTERS_WRITE,
    label: 'transporter',
    filename: 'transporter-bulk-upload-template.xlsx',
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporters`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createTransporter',
    ...authenticated('Create a transporter. Available only to the organization admin.'),
    request: { body: json(transporterValidators.createTransporter.shape.body) },
    responses: {
      201: { description: 'Created transporter' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      409: { description: 'A transporter with this name already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTransporters',
    ...authenticated(
      'List the organization transporters. Available only to the organization admin.',
    ),
    request: { query: transporterValidators.listTransporters.shape.query },
    responses: {
      200: {
        description: 'Paginated transporters — { data: { items, page, limit, total, totalPages } }',
      },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getTransporter',
    ...authenticated('Get a single transporter. Available only to the organization admin.'),
    request: { params: transporterValidators.getTransporter.shape.params },
    responses: {
      200: { description: 'Transporter detail' },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporters/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importTransportersExcel',
    ...write(
      'Bulk upload transporters from the template (GET /transporters/import/sample). Organization ' +
        'admin only. Phone repeats (in the file or of an existing transporter) are skipped. ' +
        'Transporters with a GSTIN are saved with gstVerificationStatus "pending" and verified in ' +
        'the background (gst-verification queue). ' +
        'Rows are validated like single create and created one by one; rows that fail are reported in errors and skipped. Unknown columns are ignored (ignoredColumns).',
    ),
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
                  description: '.xlsx or .csv file, maximum 5 MB / 1000 rows.',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import completed with a row-level result report' },
      400: { description: 'Invalid Excel file or missing file', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateTransporter',
    ...authenticated('Update a transporter. Available only to the organization admin.'),
    request: {
      params: transporterValidators.updateTransporter.shape.params,
      body: json(transporterValidators.updateTransporter.shape.body),
    },
    responses: {
      200: { description: 'Updated transporter' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
      409: { description: 'A transporter with this name already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteTransporter',
    ...authenticated('Soft-delete a transporter. Available only to the organization admin.'),
    request: { params: transporterValidators.deleteTransporter.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters/export`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.exportTransporters',
    ...authenticated('Transporters "Export CSV" — same filters/sort as the list. org_admin only.'),
    request: { query: transporterValidators.exportTransporters.shape.query },
    responses: { 200: { description: 'text/csv file' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters/{transporterId}/loads`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTransporterLoads',
    ...authenticated(
      'Transporter drawer "LOADS MOVED": code, customer, loading point → drop city, tonnes, trip ' +
        'freight, stage label and progress. org_admin only.',
    ),
    request: {
      params: transporterValidators.transporterLoads.shape.params,
      query: transporterValidators.transporterLoads.shape.query,
    },
    responses: { 200: { description: 'Paginated loads' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters/{transporterId}/usage`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.transporterUsage',
    ...authenticated(
      '`{ inUse, activeLoads, liveContracts }` — running loads block Make inactive / delete (409); ' +
        'liveContracts is informational. org_admin only.',
    ),
    request: { params: transporterValidators.getTransporter.shape.params },
    responses: { 200: { description: 'Usage' } },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/transporters/{transporterId}/status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateTransporterStatus',
    ...authenticated('Make a transporter active/inactive. 409 while it has running loads.'),
    request: {
      params: transporterValidators.updateStatus.shape.params,
      body: json(transporterValidators.updateStatus.shape.body),
    },
    responses: {
      200: { description: 'Updated transporter' },
      409: { description: 'In use / already in that status', ...errorContent },
    },
  });
}
