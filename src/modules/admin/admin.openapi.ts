import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { adminValidators } from './admin.validators';
import { ADMIN_ORGANIZATIONS_MANAGE } from '../../shared/constants/permissions';
import { TAGS, permissionGated, errorContent, json } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the admin module: registers every route in admin.routes.ts, in the same
 * order, under the `admin` tag. Every route here is platform_admin-only (see admin.routes.ts),
 * so unlike masters.openapi.ts there's no plain `authenticated()` route in this module.
 */

const BASE = '/admin'; // absolute path — must match its mount in composition-root.ts
const adminOnly = (description: string) => permissionGated([ADMIN_ORGANIZATIONS_MANAGE], description);

export function registerAdminOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listOrganizations',
    ...adminOnly('List organizations across all tenants, paginated and optionally filtered.'),
    request: { query: adminValidators.listOrganizations.shape.query },
    responses: {
      200: { description: 'Paginated organizations — { data: { items, page, limit, total, totalPages } }' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations/{organizationId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getOrganization',
    ...adminOnly('Get a single organization by id, regardless of tenant.'),
    request: { params: adminValidators.getOrganization.shape.params },
    responses: {
      200: { description: 'Organization detail' },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.updateOrganization',
    ...adminOnly(
      "Update an organization's status and/or GSTIN verification status.\n\n" +
        'Cross-field rule enforced server-side (not expressible in this schema): at least one of ' +
        '`status` or `gstinVerificationStatus` is required.',
    ),
    request: {
      params: adminValidators.updateOrganization.shape.params,
      body: json(adminValidators.updateOrganization.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/staff`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.createStaff',
    ...adminOnly(
      'Provision an internal staff account (sales, online/offline KYC desk, load console).\n\n' +
        '`roleId` must resolve to one of those four platform-scope roles — platform_admin and ' +
        "org_admin can't be assigned this way. The admin sets an initial password; the staff " +
        'member logs in themselves via POST /auth/login.\n\n' +
        'Optional `permissionIds` grants extra permissions on top of the role, in the same call ' +
        '(each id from GET /roles/permissions?scope=platform — group by that response\'s `module` ' +
        'field to build a checklist). Not atomic with account creation: if one id in the list is ' +
        "invalid (wrong scope, or doesn't exist), the account is still created and any ids granted " +
        'before it stay granted — the error identifies which id failed so it can be retried alone ' +
        'via POST /roles/users/{userId}/permissions. Response `permissions` is the final effective ' +
        'list (role ∪ granted), not just what this call added.',
    ),
    request: { body: json(adminValidators.createStaff.shape.body) },
    responses: {
      201: { description: 'Created staff account (no password hash in the response)' },
      400: { description: 'Validation failed, or roleId is not staff-assignable', ...errorContent },
      403: { description: 'A permissionId in the list is organization-scope, not platform-scope', ...errorContent },
      404: { description: 'Role not found, or a permissionId in the list not found', ...errorContent },
      409: { description: 'Phone number or email already in use', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listStaff',
    ...adminOnly('List internal staff accounts, paginated and optionally filtered by name/email search.'),
    request: { query: adminValidators.listStaff.shape.query },
    responses: {
      200: { description: 'Paginated staff — { data: { items, page, limit, total, totalPages } }' },
    },
  });
}
