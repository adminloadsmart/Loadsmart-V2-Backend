import { registerImportSampleOpenApi } from '../../../shared/import/openapi';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import {
  TAGS,
  SuccessResponseSchema,
  authenticated,
  errorContent,
  json,
  permissionGated,
} from '../../../shared/openapi/core';
import { contractValidators } from './contract.validators';

const BASE = `${API_VERSION_PREFIX}/masters/contracts`;

export function registerContractOpenApi(registry: OpenAPIRegistry): void {
  registerImportSampleOpenApi(registry, {
    path: `${BASE}/import/sample`,
    operationId: 'masters.contractImportSample',
    permission: MASTERS_WRITE,
    label: 'contract',
    filename: 'contract-bulk-upload-template.xlsx',
  });
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createContract',
    ...permissionGated(
      [MASTERS_WRITE],
      'Add a transporter contract on a lane. org_admin only. Rules across live contracts on the ' +
        'same lane (case-insensitive city + state) with overlapping validity: one per ' +
        'transporter, unique priority (P1, P2…), total sharePercentage ≤ 100. Violations → 409.',
    ),
    request: { body: json(contractValidators.create.shape.body) },
    responses: {
      201: { description: 'Created contract (with transporter, derived status, daysToExpiry)' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Lane rule violated / transporter inactive', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listContracts',
    ...authenticated(
      'List contracts. `status` (upcoming | active | expiring | expired) is derived from ' +
        'validity — expiring = ends within 30 days. Search matches transporter name/code/GSTIN ' +
        'and lane cities/states.',
    ),
    request: { query: contractValidators.list.shape.query },
    responses: { 200: { description: 'Paginated contracts' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/lane-allocation`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.contractLaneAllocation',
    ...authenticated(
      'Add-contract "Lane allocation" box: carriers with a contract valid today on the lane, ' +
        'allocated and remaining share %. Pass excludeContractId when editing.',
    ),
    request: { query: contractValidators.laneAllocation.shape.query },
    responses: { 200: { description: 'Lane allocation' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/export`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.exportContracts',
    ...authenticated('Contracts "Export CSV" — same filters as the list, up to 5000 rows.'),
    request: { query: contractValidators.export.shape.query },
    responses: { 200: { description: 'text/csv file' } },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importContracts',
    ...permissionGated(
      [MASTERS_WRITE],
      'Bulk upload contracts from the template (GET /contracts/import/sample, built per tenant ' +
        'with a Transporter dropdown). The Transporter cell may be the dropdown value, a code, a ' +
        'GSTIN or the exact name; each row goes through the same lane rules as POST. ' +
        'Rows are validated like single create and created one by one; rows that fail are reported in errors and skipped. Unknown columns are ignored (ignoredColumns).',
    ),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object' as const,
              required: ['file'],
              properties: { file: { type: 'string' as const, format: 'binary' } },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import report' },
      400: { description: 'Invalid file', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getContract',
    ...authenticated('Get one contract (detail / delete drawer).'),
    request: { params: contractValidators.get.shape.params },
    responses: {
      200: { description: 'Contract' },
      404: { description: 'Not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateContract',
    ...permissionGated(
      [MASTERS_WRITE],
      'Edit a contract. org_admin only. Same lane rules as POST.',
    ),
    request: {
      params: contractValidators.update.shape.params,
      body: json(contractValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated contract' },
      409: { description: 'Lane rule violated', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteContract',
    ...permissionGated(
      [MASTERS_WRITE],
      'Delete (soft) a contract — removes its rate and priority from active indenting.',
    ),
    request: { params: contractValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Not found', ...errorContent },
    },
  });
}
