import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { driverAuthValidators } from './driver-auth.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent, json } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/driver-auth`; // absolute path — must match its mount in app.ts

// A separate identity domain from TAGS.AUTH's bearer scheme — every route below either takes no
// token at all (the OTP handshake, /refresh, self-registration's OTP handshake) or a driver
// token (driver-access, tenant-scoped, or driver-identity-access, no tenant chosen yet), never
// the staff/org one. Also covers self-registration (a driver profile is global — see
// driver.entity.ts — so registration has no tenant yet) and cross-tenant relation management (a
// driver can be linked, with mutual approval, to more than one tenant at once — see
// driver-tenant-relation.entity.ts). See docs/driver-auth.md.
export function registerDriverAuthOpenApi(registry: OpenAPIRegistry): void {
  // --- Login ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/otp/request`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.requestOtp',
    description:
      'Request a login OTP for a driver phone number. Only succeeds against an already-registered global driver profile (masters.drivers) — an unregistered phone must use /register/otp/request instead. Returns a short-lived loginToken (send as the bearer token to /otp/verify).',
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
      'Verify the login OTP. Send the loginToken from /otp/request as the bearer token. Resolves the driver’s `active` tenant relations: 0 → an identity-scoped session (no tenant chosen yet, driver-identity-access token); 1 → a tenant-scoped access/refresh pair directly; 2+ → { requiresTenantSelection: true, candidates, tenantSelectionToken } — see /otp/select-tenant.',
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

  registry.registerPath({
    method: 'post',
    path: `${BASE}/select-relation`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.selectRelation',
    ...authenticated(
      'Switch the caller’s active tenant context mid-session to one of their other `active` ' +
        'relations (e.g. right after accepting an invite via POST /relations/{relationId}/accept) ' +
        'without repeating the OTP dance. Accepts either an identity-scoped or tenant-scoped token.',
    ),
    request: { body: json(driverAuthValidators.selectRelation.shape.body) },
    responses: {
      200: { description: 'Access/refresh token pair for the newly-selected relation' },
      404: { description: 'Relation not found, or not active', ...errorContent },
    },
  });

  // --- Self-registration ---
  // Mirrors the login OTP handshake above, but for a phone with no driver profile yet. A driver
  // profile is global (masters.drivers has no tenantId), so registration collects only person-
  // level fields — no tenant, salary, or employment info here; that comes from an invite/join-
  // request afterwards (see the Relations section below).

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register/otp/request`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.requestRegisterOtp',
    description:
      'Request an OTP to self-register a new driver phone number. Fails if that phone already has a self-registered profile — use /otp/request (login) instead. Returns a short-lived otpToken (send as the bearer token to /register/otp/verify).',
    request: { body: json(driverAuthValidators.requestRegisterOtp.shape.body) },
    responses: {
      200: { description: 'OTP sent — { data: { otpToken, expiresIn, message } }' },
      409: { description: 'Phone number already registered', ...errorContent },
      429: { description: 'Too many requests', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register/otp/verify`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.verifyRegisterOtp',
    description:
      'Verify the registration OTP. Send the otpToken from /register/otp/request as the bearer token. This is the point registration becomes real: creates a minimal driver profile (or reuses one a fleet owner already invited, or one from a previously abandoned registration attempt) and issues a usable session directly — { accessToken, refreshToken } — no further token-gated step. Use that token with POST /register to submit the rest of the form; if the driver never finishes it, they simply log in later (POST /otp/request + /otp/verify) and call POST /register again to resume.',
    security: [{ bearerAuth: [] }],
    request: { body: json(driverAuthValidators.verifyRegisterOtp.shape.body) },
    responses: {
      201: { description: '{ data: { driverId, accessToken, refreshToken } }' },
      401: { description: 'Invalid OTP or OTP token', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.register',
    ...authenticated(
      'Complete (or update) the caller’s own registration details — screen 1 is mandatory ' +
        '(fullName, licenseNumber, dateOfBirth, both DL photos), screens 2/3 are optional ' +
        '(bloodGroup, emergency contact + relation, hasHealthInsurance, hasLifeInsurance, ' +
        'bankDetails, onboardingStep). Callable more than once: a driver who only finished ' +
        'screen 1 the first time can call this again later (after logging back in) to add ' +
        'screens 2/3. Runs driving-licence verification (Sarathi) against licenseNumber + ' +
        'dateOfBirth every call, but `documents` is required regardless of the verification ' +
        'outcome now — both driving_license_front and driving_license_back must exist for the ' +
        'driver, cumulatively across calls (not necessarily both on the same call: a driver who ' +
        'already has one on file from a prior attempt only needs to send the other). License ' +
        'photos must be uploaded first via the tenant-less upload flow with purpose ' +
        '`masters/driver`, confirmed, then referenced by their storage key in `documents`. ' +
        '`hasHealthInsurance`/`hasLifeInsurance` are plain boolean toggles — no provider/policy/' +
        'expiry detail fields are captured. `onboardingStep` is a resume-position bookmark the ' +
        'client reports for its own 3-screen wizard UI — not validated for ordering.',
    ),
    request: { body: json(driverAuthValidators.register.shape.body) },
    responses: {
      200: {
        description:
          '{ data: { driverId, licenseVerificationStatus, driver } } — driver is the full profile (fullName, phoneNumber, license fields, blood group, address, emergency contact + relation, hasHealthInsurance, hasLifeInsurance, onboardingStep, registrationSource) with documents/verifications/bankDetails loaded',
      },
      400: {
        description:
          'Validation failed, or a referenced upload is not a confirmed masters/driver file',
        ...errorContent,
      },
      404: { description: 'Driver not found', ...errorContent },
      409: {
        description: 'License number already registered to a different driver',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register/verify-dl`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.verifyDl',
    ...authenticated(
      'Step-1 preflight, mirroring POST /masters/drivers/verify-dl — checks a licence + date of ' +
        'birth against the Sarathi registry via IDfy before the driver submits the rest of the ' +
        'registration form. Read-only: does not persist anything, and does not require ' +
        'licenseNumber/dateOfBirth to match what the driver eventually submits to /register, ' +
        'which runs this same lookup again (and is the one whose result actually gets saved as a ' +
        'driver_verifications row).',
    ),
    request: { body: json(driverAuthValidators.verifyDl.shape.body) },
    responses: {
      200: { description: 'verified (with registry fields when available) or manual_review' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register/files`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.requestUploadUrl',
    ...authenticated(
      'Step 1 of the DL-photo upload handshake for a driver who hasn’t linked to any tenant yet ' +
        '— a tenant-less mirror of driver-portal’s POST /files (which needs a tenant-scoped ' +
        'driver-access token this caller doesn’t have). Locked to purpose `masters/driver` only.',
    ),
    request: { body: json(driverAuthValidators.requestUploadUrl.shape.body) },
    responses: {
      201: { description: 'Presigned S3 POST — { file, uploadUrl, uploadFields }' },
      400: { description: 'Validation failed, or disallowed mimeType/sizeBytes', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/register/files/{fileId}/confirm`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.confirmUpload',
    ...authenticated(
      'Step 2 — confirms the direct-to-S3 upload from POST /register/files. The resulting ' +
        'storage key is what gets passed as documents[].fileUrl to POST /register.',
    ),
    responses: {
      200: { description: 'Confirmed file record' },
      404: { description: 'File not found', ...errorContent },
      409: { description: 'Upload was never completed in S3', ...errorContent },
    },
  });

  // --- Cross-tenant relation management ---
  // A driver acting on their own relations across every tenant they're linked to, not scoped to
  // one tenant — reachable with either an identity-scoped or tenant-scoped token. The tenant-side
  // half of this workflow (staff inviting a driver, approving/rejecting a join request) is under
  // TAGS.MASTERS — see driver.openapi.ts's "Driver account linking" section.

  registry.registerPath({
    method: 'get',
    path: `${BASE}/relations`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.listMyRelations',
    ...authenticated(
      'List the caller’s own driver_tenant_relations across every tenant, with each tenant’s name.',
    ),
    responses: {
      200: { description: 'The caller’s relations' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/relations/join-requests`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.requestJoin',
    ...authenticated(
      'Request to join a fleet owner found via GET /relations/organizations/search. Creates a ' +
        'relation in `pending_staff_review` (initiatedBy `driver`) and notifies that tenant’s ' +
        'org_admin/dispatch staff.',
    ),
    request: { body: json(driverAuthValidators.requestJoin.shape.body) },
    responses: {
      201: { description: '{ data: { linkId, status } }' },
      404: { description: 'Tenant not found', ...errorContent },
      409: { description: 'A relation with this fleet owner already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/relations/{relationId}/accept`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.acceptInvite',
    ...authenticated(
      'Accept a fleet-owner-initiated invite (status `pending_driver_review`). Notifies that tenant’s staff.',
    ),
    request: { params: driverAuthValidators.acceptInvite.shape.params },
    responses: {
      200: { description: '{ data: { linkId, status, tenantId } }' },
      404: {
        description: 'Invite not found, or not pending the driver’s response',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/relations/{relationId}/reject`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.rejectInvite',
    ...authenticated('Reject a fleet-owner-initiated invite, with an optional reason.'),
    request: {
      params: driverAuthValidators.rejectInvite.shape.params,
      body: json(driverAuthValidators.rejectInvite.shape.body),
    },
    responses: {
      200: { description: '{ data: { linkId, status, tenantId } }' },
      404: {
        description: 'Invite not found, or not pending the driver’s response',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/relations/organizations/search`,
    tags: [TAGS.DRIVER_AUTH],
    operationId: 'driverAuth.searchOrganizations',
    ...authenticated(
      'Search fully-active organizations by name OR by a staff member’s phone number (org_admin ' +
        'included), for a driver picking a join-request target — name + id only, no sensitive ' +
        'fields.',
    ),
    request: { query: driverAuthValidators.searchOrganizations.shape.query },
    responses: {
      200: { description: 'Matching organizations — [{ id, name }]' },
    },
  });
}
