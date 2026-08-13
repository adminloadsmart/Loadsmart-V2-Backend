import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  CUSTOMERS_APPROVE,
  CUSTOMERS_CREATE,
  CUSTOMERS_READ,
  CUSTOMERS_WRITE,
} from '../../shared/constants/permissions';
import {
  TAGS,
  SuccessResponseSchema,
  errorContent,
  json,
  permissionGated,
} from '../../shared/openapi/core';
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
      'Create a customer. org_admin creates an active customer; sales/sales_cs/dispatch/' +
        'documents_ops/finance_accounts create a pending one awaiting org_admin approval.',
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
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{customerId}/reject`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.reject',
    ...permissionGated(
      [CUSTOMERS_APPROVE],
      'Reject a pending customer with a mandatory reason. ORG_ADMIN only.',
    ),
    request: {
      params: customerValidators.reject.shape.params,
      body: json(customerValidators.reject.shape.body),
    },
    responses: {
      200: { description: 'Rejected customer' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Customer not found', ...errorContent },
      409: { description: 'Invalid status transition', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/delete/{customer_id}`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.delete',
    ...permissionGated([CUSTOMERS_WRITE], 'Soft-delete a tenant-scoped customer. ORG_ADMIN only.'),
    request: { params: customerValidators.delete.shape.params },
    responses: {
      200: { description: 'Customer deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Customer not found', ...errorContent },
    },
  });
}
