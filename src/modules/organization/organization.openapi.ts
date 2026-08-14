import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { organizationValidators } from './organization.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { ORGANIZATION_PROFILE_MANAGE } from '../../shared/constants/permissions';
import {
  TAGS,
  authenticated,
  permissionGated,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for the org onboarding endpoints — GET/POST /v1/auth/organization,
 * POST /v1/auth/organization/business, POST /v1/auth/organization/submit, and the post-submit
 * shop-board photo endpoint. Lives here (not
 * auth.openapi.ts) since the routes are org-owned, but BASE stays '/v1/auth' and the tag stays
 * TAGS.AUTH: the URLs are deliberately unchanged (see modules/organization/index.ts's
 * createOrganizationOnboardingRoutes), and core.ts's tag convention mirrors mount paths, which
 * these still share with auth.openapi.ts's routes.
 */

const BASE = `${API_VERSION_PREFIX}/auth`; // absolute path — must match its mount in app.ts
// ORGANIZATION_PROFILE_MANAGE is seeded onto org_admin only (see db/seed-roles.ts) — same
// permissionGated pattern admin.openapi.ts uses for its adminOnly routes.
const orgAdminOnly = (description: string) =>
  permissionGated([ORGANIZATION_PROFILE_MANAGE], description);

export function registerOrganizationOnboardingOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/organization`,
    tags: [TAGS.AUTH],
    operationId: 'auth.getOrganization',
    ...authenticated(
      "Get the caller's tenant organization. Returns null if the caller hasn't completed their " +
        'company profile yet (no organization exists for them).',
    ),
    responses: {
      200: { description: 'Organization, or null if none exists yet' },
      404: {
        description: 'Caller has a tenantId but no matching organization (data inconsistency)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization/shopboard-premises-photo`,
    tags: [TAGS.AUTH],
    operationId: 'auth.saveShopboardPremisesPhoto',
    ...authenticated(
      'Upload and attach a shop-board/premises image. Send multipart/form-data with purpose, step, and file; the backend uploads the image to S3. Available after the review step and before final submission.',
    ),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: organizationValidators.saveShopboardPremisesPhoto.shape.body,
          },
        },
      },
    },
    responses: {
      200: { description: 'Shop-board premises photo uploaded and onboarding step advanced' },
      400: {
        description: 'Validation failed, image is missing, or purpose/step is invalid',
        ...errorContent,
      },
      401: { description: 'Missing/invalid access token', ...errorContent },
      403: {
        description: 'Organization is already submitted or cannot be updated',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization`,
    tags: [TAGS.AUTH],
    operationId: 'auth.createOrganization',
    ...authenticated(
      "Create (first call) or update (subsequent calls) the caller's company details. On the first call this creates the organization, attaches it to the caller, and returns a fresh token pair because the caller's access token still has a null tenant.",
    ),
    request: { body: json(organizationValidators.createOrganization.shape.body) },
    responses: {
      200: {
        description:
          'Updated organization, onboarding step, review data, and on the first call also a fresh accessToken/refreshToken pair',
      },
      400: { description: 'Validation failed', ...errorContent },
      401: { description: 'Missing/invalid access token', ...errorContent },
      403: {
        description: "The organization is rejected or suspended and can't be updated",
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization/business`,
    tags: [TAGS.AUTH],
    operationId: 'auth.saveBusinessDetails',
    ...authenticated("Save business details and document uploads for the caller's organization."),
    request: { body: json(organizationValidators.saveBusinessDetails.shape.body) },
    responses: {
      200: { description: 'Business details saved, including the current review payload' },
      400: { description: 'Validation failed', ...errorContent },
      401: { description: 'Missing/invalid access token', ...errorContent },
      403: {
        description: "The organization is rejected or suspended and can't be updated",
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization/submit`,
    tags: [TAGS.AUTH],
    operationId: 'auth.submitOrganization',
    ...authenticated(
      'Submit the organization for manual KYC review after allowing the caller to review and edit the final payload.',
    ),
    request: { body: json(organizationValidators.submitOrganization.shape.body) },
    responses: {
      200: {
        description:
          'Organization submitted for review, with the updated review payload and current step returned',
      },
      400: { description: 'Validation failed', ...errorContent },
      401: { description: 'Missing/invalid access token', ...errorContent },
      403: {
        description: "The organization is rejected or suspended and can't be updated",
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization/users`,
    tags: [TAGS.AUTH],
    operationId: 'auth.inviteOrganizationUser',
    ...orgAdminOnly(
      'Org admin invites a teammate into their own org (Settings → Users & Roles) with one ' +
        'of the 4 assignable roles: Sales/CS, Dispatch, Documents/Ops, Finance/Accounts. Phone ' +
        'only, no email. Returns a one-time temporaryPassword for the admin to share manually.',
    ),
    request: { body: json(organizationValidators.inviteOrganizationUser.shape.body) },
    responses: {
      201: { description: 'Created user, with a one-time temporaryPassword' },
      400: {
        description: 'Validation failed, or role is not one of the 4 assignable roles',
        ...errorContent,
      },
      403: { description: 'Caller is not an org admin', ...errorContent },
      409: { description: 'A user with this phone number already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organization/users`,
    tags: [TAGS.AUTH],
    operationId: 'auth.listOrganizationUsers',
    ...orgAdminOnly(
      "List the caller's own org's teammates (org_admin plus invited users), paginated and " +
        'optionally filtered by role.',
    ),
    request: { query: organizationValidators.listOrganizationUsers.shape.query },
    responses: {
      200: {
        description: 'Paginated org users — { data: { items, page, limit, total, totalPages } }',
      },
      403: { description: 'Caller has no organization context yet', ...errorContent },
    },
  });
}
