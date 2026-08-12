import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  CUSTOMERS_APPROVE,
  CUSTOMERS_CREATE,
  CUSTOMERS_READ,
  CUSTOMERS_WRITE,
} from '../../shared/constants/permissions';
import { TAGS, errorContent, json, permissionGated } from '../../shared/openapi/core';
import { customerValidators } from './customer.validators';

const BASE = `${API_VERSION_PREFIX}/customers`;
export function registerCustomersOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.create',
    ...permissionGated(
      [CUSTOMERS_CREATE],
      'Create a customer. ORG_ADMIN creates an active customer; SALES creates a pending customer.',
    ),
    request: { body: json(customerValidators.create.shape.body) },
    responses: {
      201: { description: 'Created customer' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.list',
    ...permissionGated(
      [CUSTOMERS_READ],
      'List customers for the authenticated tenant. ORG_ADMIN only.',
    ),
    request: { query: customerValidators.list.shape.query },
    responses: {
      200: { description: 'Paginated customers with delivery points' },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{customerId}`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.get',
    ...permissionGated([CUSTOMERS_READ], 'Get a tenant-scoped customer. ORG_ADMIN only.'),
    request: { params: customerValidators.get.shape.params },
    responses: {
      200: { description: 'Customer details' },
      404: { description: 'Customer not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{customerId}`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.update',
    ...permissionGated([CUSTOMERS_WRITE], 'Update a tenant-scoped customer. ORG_ADMIN only.'),
    request: {
      params: customerValidators.update.shape.params,
      body: json(customerValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated customer' },
      404: { description: 'Customer not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{customerId}/approve`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.approve',
    ...permissionGated([CUSTOMERS_APPROVE], 'Approve a pending customer. ORG_ADMIN only.'),
    request: { params: customerValidators.approve.shape.params },
    responses: {
      200: { description: 'Approved customer' },
      404: { description: 'Customer not found', ...errorContent },
      409: { description: 'Invalid status transition', ...errorContent },
    },
  });
}
