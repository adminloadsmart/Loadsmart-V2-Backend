import { RequestHandler } from 'express';
import { RateLimitError } from '../errors';
import { redisManager } from '../../db/redis';

/** Per-IP request throttle for public, unauthenticated endpoints (login, verify-otp) where
 *  nothing else in the request (no req.user yet) can be used as a rate-limit key. Applied
 *  per-route, same convention as verifySignupToken — not wired globally in app.ts, since
 *  different routes want different limits. */
export const createIpRateLimit = (opts: {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
}): RequestHandler => {
  return async (req, _res, next) => {
    const key = `ratelimit:${opts.keyPrefix}:${req.ip ?? 'unknown'}`;
    const count = await redisManager.incr(key, opts.windowSeconds);
    if (count > opts.limit) {
      throw new RateLimitError('Too many requests, please try again later');
    }
    next();
  };
};
