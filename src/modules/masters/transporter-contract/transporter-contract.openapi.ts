import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { transporterContractValidators } from './transporter-contract.validators';
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

export function registerTransporterContractOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporter-contracts`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createTransporterContract',
    ...write(
      "Create a customer's transporter contract on a lane (city + state), with rate, unit, expiry, priority (1 = P1) and share of business. Share defaults to 100 when the lane has no other contract.",
    ),
    request: { body: json(transporterContractValidators.createContract.shape.body) },
    responses: {
      201: { description: 'Created contract' },
      400: { description: 'Validation failed or lane share would exceed 100%', ...errorContent },
      404: { description: 'Customer or transporter not found', ...errorContent },
      409: {
        description: 'Priority or transporter already used on this lane for the period',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-contracts`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTransporterContracts',
    ...authenticated(
      'List transporter contracts, filterable by customer, transporter, lane and status.',
    ),
    request: { query: transporterContractValidators.listContracts.shape.query },
    responses: {
      200: {
        description: 'Paginated contracts — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-contracts/lane-summary`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getTransporterContractLaneSummary',
    ...authenticated(
      "A customer lane's unexpired contracts in priority order, with the share-of-business total.",
    ),
    request: { query: transporterContractValidators.laneSummary.shape.query },
    responses: {
      200: { description: 'Lane summary' },
      400: { description: 'Invalid lane', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporter-contracts/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importTransporterContractsExcel',
    ...write(
      'Bulk upload transporter contracts from an Excel file. Customers are matched by code and transporters by phone.',
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
                  description: 'Excel file (.xlsx), maximum 5 MB.',
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
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-contracts/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getTransporterContract',
    ...authenticated('Get a single transporter contract.'),
    request: { params: transporterContractValidators.getContract.shape.params },
    responses: {
      200: { description: 'Contract detail' },
      404: { description: 'Contract not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/transporter-contracts/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateTransporterContract',
    ...write('Update a transporter contract. The customer cannot be changed.'),
    request: {
      params: transporterContractValidators.updateContract.shape.params,
      body: json(transporterContractValidators.updateContract.shape.body),
    },
    responses: {
      200: { description: 'Updated contract' },
      400: { description: 'Validation failed or lane share would exceed 100%', ...errorContent },
      404: { description: 'Contract not found', ...errorContent },
      409: {
        description: 'Priority or transporter already used on this lane for the period',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/transporter-contracts/{contractId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteTransporterContract',
    ...write('Soft-delete a transporter contract.'),
    request: { params: transporterContractValidators.deleteContract.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Contract not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/customers/{customerId}/transporter-contracts`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listCustomerTransporterContracts',
    ...authenticated("A customer's transporter contracts grouped by lane, P1 first."),
    request: { params: transporterContractValidators.customerContracts.shape.params },
    responses: { 200: { description: 'Contracts grouped by lane' } },
  });
}
