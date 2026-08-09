import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { organizationValidators } from './organization.validators';
import { TAGS, authenticated, errorContent, json } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the org onboarding endpoints — GET/POST /auth/organization,
 * POST /auth/organization/business, POST /auth/organization/submit. Lives here (not
 * auth.openapi.ts) since the routes are org-owned, but BASE stays '/auth' and the tag stays
 * TAGS.AUTH: the URLs are deliberately unchanged (see modules/organization/index.ts's
 * createOrganizationOnboardingRoutes), and core.ts's tag convention mirrors mount paths, which
 * these still share with auth.openapi.ts's routes.
 */

const BASE = '/auth'; // absolute path — must match its mount in composition-root.ts

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
}
