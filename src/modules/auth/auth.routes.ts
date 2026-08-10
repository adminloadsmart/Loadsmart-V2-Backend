import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { verifySignupToken } from '../../shared/middleware/signup-token.middleware';
import { verifyLoginToken } from '../../shared/middleware/login-token.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
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
  const requestLoginOtpRateLimit = createIpRateLimit({
    keyPrefix: 'login-otp-request',
    limit: env.loginOtpRequestRateLimitMax,
    windowSeconds: env.loginOtpRequestRateLimitWindowSeconds,
  });
  const verifyLoginOtpRateLimit = createIpRateLimit({
    keyPrefix: 'login-otp-verify',
    limit: env.loginOtpVerifyRateLimitMax,
    windowSeconds: env.loginOtpVerifyRateLimitWindowSeconds,
  });
  const verifyOtpRateLimit = createIpRateLimit({
    keyPrefix: 'verify-otp',
    limit: env.verifyOtpRateLimitMax,
    windowSeconds: env.verifyOtpRateLimitWindowSeconds,
  });

  router.post(
    '/signup',
    signupRateLimit,
    validate(authValidators.signup),
    asyncHandler(controller.signup),
  );
  router.post(
    '/verify-otp',
    verifyOtpRateLimit,
    validate(authValidators.verifyOtp),
    verifySignupToken,
    asyncHandler(controller.verifyOtp),
  );
  router.post(
    '/login/otp/request',
    requestLoginOtpRateLimit,
    validate(authValidators.requestLoginOtp),
    asyncHandler(controller.requestLoginOtp),
  );
  router.post(
    '/login/otp/verify',
    verifyLoginOtpRateLimit,
    validate(authValidators.verifyLoginOtp),
    verifyLoginToken,
    asyncHandler(controller.verifyLoginOtp),
  );
  router.post(
    '/login',
    loginRateLimit,
    validate(authValidators.login),
    asyncHandler(controller.login),
  );
  router.post('/refresh', validate(authValidators.refresh), asyncHandler(controller.refresh));

  return router;
}

export function createAuthProtectedRoutes(controller: AuthController): Router {
  const router = Router();

  router.post('/logout', validate(authValidators.logout), asyncHandler(controller.logout));
  router.delete('/account', asyncHandler(controller.deleteAccount));
  router.post(
    '/password',
    validate(authValidators.createPassword),
    asyncHandler(controller.createPassword),
  );

  return router;
}
