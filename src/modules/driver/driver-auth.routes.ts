import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { verifyDriverLoginToken } from '../../shared/middleware/driver-login-token.middleware';
import { verifyDriverTenantSelectToken } from '../../shared/middleware/driver-tenant-select-token.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { env } from '../../config/env';
import { DriverAuthController } from './driver-auth.controller';
import { driverAuthValidators } from './driver-auth.validators';

// Mounted at /v1/driver-auth — entirely public (no bearer token needed to reach any of these),
// same reasoning as modules/auth/auth.routes.ts's createAuthPublicRoutes: nothing else in an
// unauthenticated request can gate it besides per-IP throttles ahead of validate()/token checks.
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

  return router;
}

// Mounted at the same /v1/driver-auth prefix as the public router above (two routers sharing one
// mount, same pattern modules/auth/'s public/protected split and modules/organization/'s
// onboarding router use) — but gated by createDriverAuth (built in index.ts, where
// DriverRepository is already constructed — routes files don't import repositories directly, see
// boundaries/dependencies), since driver routers sit in their own pre-authMiddleware tier in
// app.ts (see composition-root.ts's driverRouters).
export function createDriverAuthProtectedRoutes(
  controller: DriverAuthController,
  driverAuth: RequestHandler,
): Router {
  const router = Router();

  router.use(driverAuth);

  // No body — sid/jti/exp come from the caller's own access token, see driver-auth.controller.ts.
  router.post('/logout', asyncHandler(controller.logout));
  router.post(
    '/device-token',
    validate(driverAuthValidators.updateDeviceToken),
    asyncHandler(controller.updateDeviceToken),
  );

  return router;
}
