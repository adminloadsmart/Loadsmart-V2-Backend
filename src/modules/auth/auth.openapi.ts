import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { authValidators } from './auth.validators';
import {
  TAGS,
  authenticated,
  SuccessResponseSchema,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for the auth module: registers every route in auth.routes.ts (public +
 * protected) under the `auth` tag.
 *
 * auth.validators.ts is never imported for anything but its Zod schemas — request shapes here
 * are the literal same schema objects used by the `validate()` middleware, not redescribed.
 * Success response *bodies* aren't documented (see core.ts) — only status code + description —
 * except for the fixed `{ success: true }` shape on delete-style endpoints.
 */

const BASE = '/auth'; // absolute path — must match its mount in composition-root.ts

export function registerAuthOpenApi(registry: OpenAPIRegistry): void {
  /**
   * A distinct scheme from the main bearerAuth: same transport (Authorization: Bearer <token>,
   * see signup-token.middleware.ts), but a short-lived, purpose-scoped JWT, not the access/
   * refresh pair — only valid for POST /auth/verify-otp. Registered here (not core.ts) since
   * it's a concept owned entirely by this module.
   */
  const signupTokenAuth = registry.registerComponent('securitySchemes', 'signupTokenAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'The short-lived signup token returned by POST /auth/signup. Send as `Authorization: Bearer <signupToken>`.',
  });

  // --- Public ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/signup`,
    tags: [TAGS.AUTH],
    operationId: 'auth.signup',
    summary: 'Send OTP to a phone number',
    description:
      'Sends an OTP to the phone number and returns a short-lived signup token. Follow up with POST /auth/verify-otp. ' +
      'Repeat calls for the same phone number are subject to a short cooldown.',
    request: { body: json(authValidators.signup.shape.body) },
    responses: {
      201: { description: 'OTP sent — { signupToken, expiresIn, message }' },
      400: { description: 'Validation failed', ...errorContent },
      429: {
        description: 'On cooldown for this phone number, or too many requests from this IP',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/verify-otp`,
    tags: [TAGS.AUTH],
    operationId: 'auth.verifyOtp',
    summary: 'Verify the OTP and obtain tokens',
    description:
      'Requires the signup token returned by POST /auth/signup, sent via the Authorization header ' +
      '(checked by verifySignupToken before this handler runs) — not the main access/refresh pair. ' +
      'On first verification, creates the user if needed and returns onboarding state.',
    security: [{ [signupTokenAuth.name]: [] }],
    request: { body: json(authValidators.verifyOtp.shape.body) },
    responses: {
      200: { description: 'Tokens issued — includes user summary and onboarding state' },
      400: { description: 'Validation failed', ...errorContent },
      401: {
        description:
          'Missing/invalid/expired signup token, invalid OTP, or too many incorrect attempts',
        ...errorContent,
      },
      429: { description: 'Too many requests from this IP', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/login`,
    tags: [TAGS.AUTH],
    operationId: 'auth.login',
    summary: 'Log in with mobile number + password',
    request: { body: json(authValidators.login.shape.body) },
    responses: {
      200: {
        description:
          'Tokens issued — includes user summary, permissions, accessToken, refreshToken, onboardingStatus, and nextStep',
      },
      400: { description: 'Validation failed', ...errorContent },
      401: {
        description: 'Invalid credentials, or too many recent failed attempts',
        ...errorContent,
      },
      429: { description: 'Too many requests from this IP', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/password`,
    tags: [TAGS.AUTH],
    operationId: 'auth.createPassword',
    ...authenticated("Create the caller's password after OTP login."),
    request: { body: json(authValidators.createPassword.shape.body) },
    responses: {
      200: { description: 'Password created' },
      400: { description: 'Validation failed', ...errorContent },
      401: { description: 'Missing/invalid access token', ...errorContent },
      409: { description: 'Password already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/refresh`,
    tags: [TAGS.AUTH],
    operationId: 'auth.refresh',
    summary: 'Exchange a refresh token for a new token pair',
    description: 'The refresh token is single-use: this call revokes it and issues a new pair.',
    request: { body: json(authValidators.refresh.shape.body) },
    responses: {
      200: { description: 'Tokens issued — { accessToken, refreshToken }' },
      400: { description: 'Validation failed', ...errorContent },
      401: { description: 'Invalid or expired refresh token', ...errorContent },
    },
  });

  // --- Protected ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/logout`,
    tags: [TAGS.AUTH],
    operationId: 'auth.logout',
    ...authenticated('Revoke the given refresh token and block the current access token.'),
    request: { body: json(authValidators.logout.shape.body) },
    responses: {
      200: { description: 'Logged out', ...json(SuccessResponseSchema) },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/account`,
    tags: [TAGS.AUTH],
    operationId: 'auth.deleteAccount',
    ...authenticated(
      "Soft-delete the caller's own account and revoke all of their refresh tokens.",
    ),
    responses: {
      200: { description: 'Account deleted', ...json(SuccessResponseSchema) },
    },
  });

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
    request: { body: json(authValidators.createOrganization.shape.body) },
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
    request: { body: json(authValidators.saveBusinessDetails.shape.body) },
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
    request: { body: json(authValidators.submitOrganization.shape.body) },
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
