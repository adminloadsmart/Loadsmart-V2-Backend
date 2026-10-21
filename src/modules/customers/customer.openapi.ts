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
const excelFileBody = {
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object' as const,
        required: ['file'],
        properties: {
          file: {
            type: 'string' as const,
            format: 'binary',
            description: 'Excel file (.xlsx), maximum 5 MB.',
          },
        },
      },
    },
  },
};

export function registerCustomersOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/import/sample`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.importSample',
    ...permissionGated(
      [CUSTOMERS_CREATE],
      'Download the bulk-upload template (.xlsx): a "Customers" sheet whose columns are exactly ' +
        'the ones the import reads (with an example row and dropdowns), plus an "Instructions" ' +
        'sheet listing required columns and formats.',
    ),
    responses: {
      200: {
        description: 'customer-bulk-upload-template.xlsx',
        content: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/import/preview`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.importPreview',
    ...permissionGated(
      [CUSTOMERS_CREATE],
      'Dry-run a customer Excel import: parses and validates every row (including duplicate/' +
        'existing-customer checks) without creating anything. Returns the same report shape as ' +
        'the real import, with created always 0.',
    ),
    request: { body: excelFileBody },
    responses: {
      200: { description: 'Import report (nothing created)' },
      400: { description: 'Invalid or missing .xlsx/.csv file', ...errorContent },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/import`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.import',
    ...permissionGated(
      [CUSTOMERS_CREATE],
      'Bulk import customers from the template (.xlsx or .csv, up to 5 MB / 1000 rows). Headers ' +
        "follow GET /customers/import/sample; older sheets' headers are still matched. Each " +
        'row is validated like POST /customers and created on its own — rows that fail, or ' +
        'repeat a GSTIN/mobile in the file or of an existing customer, are reported in errors ' +
        '[{ row, field, message }] and skipped. Customers with a GSTIN are saved with ' +
        'gstVerificationStatus "pending" and verified in the background (gst-verification queue).',
    ),
    request: { body: excelFileBody },
    responses: {
      201: {
        description:
          'Import report: { total, validRows, created, failed, gstVerificationQueued, columnMapping, errors }',
      },
      400: { description: 'Invalid or missing .xlsx/.csv file', ...errorContent },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.create',
    ...permissionGated(
      [CUSTOMERS_CREATE],
      'Create a customer. org_admin creates an active customer; sales/sales_cs/dispatch/' +
        'documents_ops/finance_accounts create a pending one awaiting org_admin approval. ' +
        'Requires gstin, name (legal business name), registeredAddress and at least one contact ' +
        '(phone + email). Send `gstVerificationId` from POST /masters/gst/verify to store the ' +
        'customer as GST-verified; without it the GSTIN is saved as an unverified manual entry. ' +
        'Legacy single-contact/billing fields are still accepted (deprecated).',
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
    method: 'patch',
    path: `${BASE}/{customerId}/status`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.updateStatus',
    ...permissionGated(
      [CUSTOMERS_WRITE],
      "Toggle a customer between 'active' and 'inactive'. Separate from the pending-review " +
        'approve/reject flow. ORG_ADMIN only.',
    ),
    request: {
      params: customerValidators.updateStatus.shape.params,
      body: json(customerValidators.updateStatus.shape.body),
    },
    responses: {
      200: { description: 'Customer with updated status' },
      400: { description: 'Validation failed', ...errorContent },
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
  registry.registerPath({
    method: 'get',
    path: `${BASE}/export`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.export',
    ...permissionGated(
      [CUSTOMERS_READ],
      'Settings → Customers "Export CSV" — same filters as the list (no paging), up to 5000 rows. ' +
        'ORG_ADMIN only.',
    ),
    request: { query: customerValidators.export.shape.query },
    responses: {
      200: { description: 'text/csv file' },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{customerId}/loads`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.listLoads',
    ...permissionGated(
      [CUSTOMERS_READ],
      'Customer detail drawer "LOADS": the customer\'s loads newest first (via requisition or ' +
        'posting) with tonnes, fleet type, stage label and progress (0–1). ORG_ADMIN only.',
    ),
    request: {
      params: customerValidators.loads.shape.params,
      query: customerValidators.loads.shape.query,
    },
    responses: {
      200: { description: 'Paginated load rows' },
      404: { description: 'Customer not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{customerId}/usage`,
    tags: [TAGS.CUSTOMERS],
    operationId: 'customers.usage',
    ...permissionGated(
      [CUSTOMERS_READ],
      '`{ inUse, activeLoads: [{ id, code, status }] }` — loads not yet closed for this customer. ' +
        'Make inactive and delete return 409 with the same `activeLoads` while inUse is true.',
    ),
    request: { params: customerValidators.get.shape.params },
    responses: {
      200: { description: 'Usage' },
      404: { description: 'Customer not found', ...errorContent },
    },
  });
}
