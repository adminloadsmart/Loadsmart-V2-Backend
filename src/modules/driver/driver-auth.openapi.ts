import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { driverAuthValidators } from './driver-auth.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent, json } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/driver-auth`; // absolute path — must match its mount in app.ts

// A separate identity domain from TAGS.AUTH's bearer scheme — every route below either takes no
// token at all (the OTP handshake, /refresh) or a driver-access token, never the staff/org one.
// See docs/driver-auth.md.
export function registerDriverAuthOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/otp/request`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.requestOtp',
    description:
      'Request a login OTP for a driver phone number. Only succeeds against an already-approved, active masters.drivers record — drivers cannot self-register. Returns a short-lived loginToken (send as the bearer token to /otp/verify).',
    request: { body: json(driverAuthValidators.requestOtp.shape.body) },
    responses: {
      200: { description: 'OTP sent — { data: { loginToken, expiresIn, message } }' },
      401: { description: 'Driver is not registered', ...errorContent },
      429: { description: 'Too many requests', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/otp/verify`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.verifyOtp',
    description:
      'Verify the OTP. Send the loginToken from /otp/request as the bearer token. Returns either an access/refresh token pair, or (if the phone matched active driver records in more than one tenant) { requiresTenantSelection: true, candidates, tenantSelectionToken } — see /otp/select-tenant.',
    security: [{ bearerAuth: [] }],
    request: { body: json(driverAuthValidators.verifyOtp.shape.body) },
    responses: {
      200: { description: 'Token pair, or a tenant-selection prompt' },
      401: { description: 'Invalid OTP or login token', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/otp/select-tenant`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.selectTenant',
    description:
      'Completes login when /otp/verify returned requiresTenantSelection. Send the tenantSelectionToken as the bearer token.',
    security: [{ bearerAuth: [] }],
    request: { body: json(driverAuthValidators.selectTenant.shape.body) },
    responses: {
      200: { description: 'Access/refresh token pair' },
      401: { description: 'Invalid tenant selection or selection token', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/refresh`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.refresh',
    description: 'Rotate a driver refresh token for a new access/refresh pair.',
    request: { body: json(driverAuthValidators.refresh.shape.body) },
    responses: {
      200: { description: 'New access/refresh token pair' },
      401: { description: 'Invalid or expired refresh token', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/logout`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.logout',
    ...authenticated('Revoke the caller’s current driver session.'),
    responses: { 200: { description: '{ success: true }' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/device-token`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.updateDeviceToken',
    ...authenticated('Update the FCM push token registered against the caller’s current session.'),
    request: { body: json(driverAuthValidators.updateDeviceToken.shape.body) },
    responses: {
      200: { description: '{ success: true }' },
      404: { description: 'No active session found', ...errorContent },
    },
  });
}
