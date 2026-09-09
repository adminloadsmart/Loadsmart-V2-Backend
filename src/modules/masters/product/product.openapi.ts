import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { productValidators } from './product.validators';
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

export function registerProductOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/products/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importProductsExcel',
    ...write(
      'Bulk import products from an Excel file. Each row creates one product and optional sub-items.',
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
      201: { description: 'Import report with created and failed row counts' },
      400: { description: 'Invalid Excel file or missing file', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/products`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createProduct',
    ...write(
      'Create a product with optional sub-items. Org admins are automatically approved; other permitted creators remain pending.',
    ),
    request: { body: json(productValidators.create.shape.body) },
    responses: {
      201: { description: 'Created product' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/products`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listProducts',
    ...authenticated('List tenant products with pagination, search, and approval/status filters.'),
    request: { query: productValidators.list.shape.query },
    responses: { 200: { description: 'Paginated products with active sub-items' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getProduct',
    ...authenticated('Get a product and its active sub-items.'),
    request: { params: productValidators.get.shape.params },
    responses: {
      200: { description: 'Product detail' },
      404: { description: 'Product not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateProduct',
    ...write('Update product fields and add, edit, or soft-delete sub-items transactionally.'),
    request: {
      params: productValidators.update.shape.params,
      body: json(productValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated product' },
      404: { description: 'Product not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveProduct',
    ...approve('Approve a pending product. org_admin only.'),
    request: { params: productValidators.approve.shape.params },
    responses: {
      200: { description: 'Approved product' },
      409: { description: 'Product is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectProduct',
    ...approve('Reject a pending product with a mandatory reason. org_admin only.'),
    request: {
      params: productValidators.reject.shape.params,
      body: json(productValidators.reject.shape.body),
    },
    responses: {
      200: { description: 'Rejected product' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Product is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setProductStatus',
    ...write('Set a product active or inactive.'),
    request: {
      params: productValidators.status.shape.params,
      body: json(productValidators.status.shape.body),
    },
    responses: { 200: { description: 'Updated product status' } },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteProduct',
    ...write('Soft-delete a product and all of its sub-items.'),
    request: { params: productValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Product not found', ...errorContent },
    },
  });
}
