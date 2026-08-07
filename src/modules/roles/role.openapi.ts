import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { roleValidators } from './role.validators';
import {
  TAGS,
  authenticated,
  SuccessResponseSchema,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for role.routes.ts — role assignment and permission grants for users, all owned
 * by this module (entities, repository, service, and this API layer). auth.service.ts imports
 * this module's RoleService directly (same pattern admin/ already uses for auth's
 * organizationService) to build the JWT's `permissions` claim — a one-directional dependency,
 * not a reason for this code to live inside modules/auth/. None of these routes carry a flat
 * role/permission requirement: authorization is contextual (assertCanManage in role.service.ts),
 * so only `authenticated()` applies here — the real rule is documented in each operation's
 * description instead.
 */

const BASE = '/roles'; // absolute path — must match its mount in composition-root.ts

export function registerRoleOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.ROLES],
    operationId: 'role.listRoles',
    ...authenticated(
      'List the fixed role catalog, optionally filtered by scope — for an "assign role" dropdown.',
    ),
    request: { query: roleValidators.listRoles.shape.query },
    responses: { 200: { description: 'Roles' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/permissions`,
    tags: [TAGS.ROLES],
    operationId: 'role.listPermissions',
    ...authenticated(
      'List the fixed permission catalog, optionally filtered by scope — for a "grant permission" checklist UI.',
    ),
    request: { query: roleValidators.listPermissions.shape.query },
    responses: { 200: { description: 'Permissions' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/users/{userId}/permissions`,
    tags: [TAGS.ROLES],
    operationId: 'role.getUserPermissions',
    ...authenticated(
      "Get a user's effective permissions (role permissions ∪ direct grants).\n\n" +
        'Allowed for: platform_admin (any user), org_admin (users in their own org only), or the user themself.',
    ),
    request: { params: roleValidators.getUserPermissions.shape.params },
    responses: {
      200: { description: 'Role + role permissions + direct grants + effective (deduped) list' },
      403: { description: "Not authorized to view this user's permissions", ...errorContent },
      404: { description: 'User not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/users/{userId}/role`,
    tags: [TAGS.ROLES],
    operationId: 'role.assignRole',
    ...authenticated(
      'Assign a role to a user, replacing their current one.\n\n' +
        'platform_admin may only assign platform-scope roles; org_admin may only assign organization-scope ' +
        'roles to a user in their own org (this is how a second org_admin gets created after self-signup).',
    ),
    request: {
      params: roleValidators.assignRole.shape.params,
      body: json(roleValidators.assignRole.shape.body),
    },
    responses: {
      200: { description: 'The assigned role' },
      400: { description: 'Validation failed', ...errorContent },
      403: {
        description: 'Caller not authorized to assign this role to this user',
        ...errorContent,
      },
      404: { description: 'User or role not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/users/{userId}/permissions`,
    tags: [TAGS.ROLES],
    operationId: 'role.grantPermission',
    ...authenticated(
      'Grant a user an extra permission directly, on top of what their role already grants.\n\n' +
        'Same scope/ownership rule as assigning a role — see PATCH /roles/users/{userId}/role.',
    ),
    request: {
      params: roleValidators.grantPermission.shape.params,
      body: json(roleValidators.grantPermission.shape.body),
    },
    responses: {
      201: { description: 'The granted permission' },
      400: { description: 'Validation failed', ...errorContent },
      403: {
        description: 'Caller not authorized to grant this permission to this user',
        ...errorContent,
      },
      404: { description: 'User or permission not found', ...errorContent },
      409: { description: 'User already has this permission granted directly', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/users/{userId}/permissions/{permissionId}`,
    tags: [TAGS.ROLES],
    operationId: 'role.revokePermission',
    ...authenticated(
      'Revoke a directly-granted permission from a user. Does not affect permissions they have via their role.',
    ),
    request: { params: roleValidators.revokePermission.shape.params },
    responses: {
      200: { description: 'Revoked', ...json(SuccessResponseSchema) },
      403: {
        description: 'Caller not authorized to revoke this permission from this user',
        ...errorContent,
      },
      404: { description: 'User, permission, or grant not found', ...errorContent },
    },
  });
}
