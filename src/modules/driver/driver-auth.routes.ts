import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { verifyDriverLoginToken } from '../../shared/middleware/driver-login-token.middleware';
import { verifyDriverTenantSelectToken } from '../../shared/middleware/driver-tenant-select-token.middleware';
import { verifyDriverRegisterOtpToken } from '../../shared/middleware/driver-registration-token.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { env } from '../../config/env';
import { DriverAuthController } from './driver-auth.controller';
import { driverAuthValidators } from './driver-auth.validators';

// Mounted at /v1/driver-auth — entirely public (no bearer token needed to reach any of these),
// same reasoning as modules/auth/auth.routes.ts's createAuthPublicRoutes: nothing else in an
// unauthenticated request can gate it besides per-IP throttles ahead of validate()/token checks.
// Also carries self-registration (register/otp/*, /register) — a driver's login and registration
// are the same public, unauthenticated entry point into this identity domain, so they share one
// router instead of a separate driver-registration module.
export function createDriverAuthPublicRoutes(controller: DriverAuthController): Router {
  const router = Router();

  const requestOtpRateLimit = createIpRateLimit({
    keyPrefix: 'driver-login-otp-request',
    limit: env.driverLoginOtpRequestRateLimitMax,
    windowSeconds: env.driverLoginOtpRequestRateLimitWindowSeconds,
  });
  const verifyOtpRateLimit = createIpRateLimit({
    keyPrefix: 'driver-login-otp-verify',
    limit: env.driverLoginOtpVerifyRateLimitMax,
    windowSeconds: env.driverLoginOtpVerifyRateLimitWindowSeconds,
  });
  const requestRegisterOtpRateLimit = createIpRateLimit({
    keyPrefix: 'driver-register-otp-request',
    limit: env.driverLoginOtpRequestRateLimitMax,
    windowSeconds: env.driverLoginOtpRequestRateLimitWindowSeconds,
  });
  const verifyRegisterOtpRateLimit = createIpRateLimit({
    keyPrefix: 'driver-register-otp-verify',
    limit: env.driverLoginOtpVerifyRateLimitMax,
    windowSeconds: env.driverLoginOtpVerifyRateLimitWindowSeconds,
  });

  router.post(
    '/otp/request',
    requestOtpRateLimit,
    validate(driverAuthValidators.requestOtp),
    asyncHandler(controller.requestOtp),
  );
  router.post(
    '/otp/verify',
    verifyOtpRateLimit,
    validate(driverAuthValidators.verifyOtp),
    verifyDriverLoginToken,
    asyncHandler(controller.verifyOtp),
  );
  // Only reachable with a driver-tenant-select token, itself only issued by /otp/verify when
  // more than one tenant's active driver record matched the phone — see driver-auth.service.ts.
  router.post(
    '/otp/select-tenant',
    validate(driverAuthValidators.selectTenant),
    verifyDriverTenantSelectToken,
    asyncHandler(controller.selectTenant),
  );
  router.post('/refresh', validate(driverAuthValidators.refresh), asyncHandler(controller.refresh));

  // Self-registration's phone-verification step — a phone with no driver profile yet, as opposed
  // to login's "this phone must already be registered". Unlike login, verify here creates the
  // driver profile and issues a real session directly — see driver-identity.service.ts's
  // verifyOtp. Completing the rest of the registration form (POST /register) is an authenticated
  // call on the protected router below, not a further public/token-gated step.
  router.post(
    '/register/otp/request',
    requestRegisterOtpRateLimit,
    validate(driverAuthValidators.requestRegisterOtp),
    asyncHandler(controller.requestRegisterOtp),
  );
  router.post(
    '/register/otp/verify',
    verifyRegisterOtpRateLimit,
    validate(driverAuthValidators.verifyRegisterOtp),
    verifyDriverRegisterOtpToken,
    asyncHandler(controller.verifyRegisterOtp),
  );

  return router;
}

// Mounted at the same /v1/driver-auth prefix as the public router above (two routers sharing one
// mount, same pattern modules/auth/'s public/protected split and modules/organization/'s
// onboarding router use) — but gated by createDriverAuth (built in index.ts, where
// DriverRepository is already constructed — routes files don't import repositories directly, see
// boundaries/dependencies), since driver routers sit in their own pre-authMiddleware tier in
// app.ts (see composition-root.ts's driverRouters). Also carries cross-tenant relation management
// (/relations/*) — a driver acting on their own relations isn't scoped to one tenant, so it needs
// the same requireTenant: false driverAuth this router is already gated by.
export function createDriverAuthProtectedRoutes(
  controller: DriverAuthController,
  driverAuth: RequestHandler,
): Router {
  const router = Router();

  router.use(driverAuth);

  // Throttles POST /register/verify-dl — it fans out to the same paid Sarathi lookup as
  // masters/driver.routes.ts's verify-dl. Separate keyPrefix/bucket from the staff-side one.
  const verifyDlRateLimit = createIpRateLimit({
    keyPrefix: 'driver-auth-verify-dl',
    limit: env.driverVerifyDlRateLimitMax,
    windowSeconds: env.driverVerifyDlRateLimitWindowSeconds,
  });

  // Completes/updates the caller's own registration details (screen 1 mandatory, screens 2/3
  // optional) — callable again to resume after an incomplete first attempt. See
  // driver-identity.service.ts's completeRegistration.
  router.post(
    '/register',
    validate(driverAuthValidators.register),
    asyncHandler(controller.register),
  );

  // Step-1 preflight — lets the app show the Sarathi verification result before the driver
  // submits the rest of the form. See DriverIdentityService.checkDrivingLicence.
  router.post(
    '/register/verify-dl',
    verifyDlRateLimit,
    validate(driverAuthValidators.verifyDl),
    asyncHandler(controller.verifyDl),
  );

  // Upload handshake for the driver's own DL photos before /register — tenant-less mirror of
  // driver-portal's /files endpoints. The resulting key is what gets passed as documents[].fileUrl.
  router.post(
    '/register/files',
    validate(driverAuthValidators.requestUploadUrl),
    asyncHandler(controller.requestUploadUrl),
  );
  router.post(
    '/register/files/:fileId/confirm',
    validate(driverAuthValidators.confirmUpload),
    asyncHandler(controller.confirmUpload),
  );

  // No body — sid/jti/exp come from the caller's own access token, see driver-auth.controller.ts.
  router.post('/logout', asyncHandler(controller.logout));
  router.post(
    '/device-token',
    validate(driverAuthValidators.updateDeviceToken),
    asyncHandler(controller.updateDeviceToken),
  );
  // Switches active tenant context mid-session — e.g. right after accepting an invite below.
  // See driver-auth.service.ts's selectRelation.
  router.post(
    '/select-relation',
    validate(driverAuthValidators.selectRelation),
    asyncHandler(controller.selectRelation),
  );

  router.get('/relations', asyncHandler(controller.listMyRelations));
  router.post(
    '/relations/join-requests',
    validate(driverAuthValidators.requestJoin),
    asyncHandler(controller.requestJoin),
  );
  router.post(
    '/relations/:relationId/accept',
    validate(driverAuthValidators.acceptInvite),
    asyncHandler(controller.acceptInvite),
  );
  router.post(
    '/relations/:relationId/reject',
    validate(driverAuthValidators.rejectInvite),
    asyncHandler(controller.rejectInvite),
  );
  // Join-request target search — name + id only, no sensitive fields, restricted to fully active
  // orgs, matched by org name or a staff member's phone number (see
  // OrganizationRepository.searchActiveByNameOrPhone).
  router.get(
    '/relations/organizations/search',
    validate(driverAuthValidators.searchOrganizations),
    asyncHandler(controller.searchOrganizations),
  );

  return router;
}
