import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { verifySignupToken } from '../../shared/middleware/signup-token.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { ORGANIZATION_PROFILE_MANAGE } from '../../shared/constants/permissions';
import { env } from '../../config/env';
import { AuthController } from './auth.controller';
import { authValidators } from './auth.validators';

export function createAuthPublicRoutes(controller: AuthController): Router {
  const router = Router();

  // Per-IP throttles on the public, unauthenticated endpoints — nothing else in an unauthenticated
  // request (no req.user yet) can be used as a rate-limit key. Placed ahead of validate() so
  // over-limit requests are rejected before any zod/DB work.
  const signupRateLimit = createIpRateLimit({
    keyPrefix: 'signup',
    limit: env.signupRateLimitMax,
    windowSeconds: env.signupRateLimitWindowSeconds,
  });
  const loginRateLimit = createIpRateLimit({
    keyPrefix: 'login',
    limit: env.loginRateLimitMax,
    windowSeconds: env.loginRateLimitWindowSeconds,
  });
  const verifyOtpRateLimit = createIpRateLimit({
    keyPrefix: 'verify-otp',
    limit: env.verifyOtpRateLimitMax,
    windowSeconds: env.verifyOtpRateLimitWindowSeconds,
  });

  router.post('/signup', signupRateLimit, validate(authValidators.signup), asyncHandler(controller.signup));
  router.post(
    '/verify-otp',
    verifyOtpRateLimit,
    validate(authValidators.verifyOtp),
    verifySignupToken,
    asyncHandler(controller.verifyOtp),
  );
  router.post('/login', loginRateLimit, validate(authValidators.login), asyncHandler(controller.login));
  router.post('/refresh', validate(authValidators.refresh), asyncHandler(controller.refresh));

  return router;
}

export function createAuthProtectedRoutes(controller: AuthController): Router {
  const router = Router();

  router.post('/logout', validate(authValidators.logout), asyncHandler(controller.logout));
  router.delete('/account', asyncHandler(controller.deleteAccount));
  router.get('/organization', asyncHandler(controller.getOrganization));
  router.post(
    '/organization',
    requirePermission(ORGANIZATION_PROFILE_MANAGE),
    validate(authValidators.createOrganization),
    asyncHandler(controller.createOrganization),
  );

  return router;
}
