import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { AuthenticatedDriver } from './request.types';
import { extractBearerToken, verifyToken } from '../utils/token';
import { isTokenBlocked } from '../utils/token-blocklist';
import { DriverRepository } from '../../modules/driver/driver.repository';

/**
 * The driver-app counterpart to auth.middleware.ts's createAuth — deliberately a separate
 * middleware, not a branch inside createAuth, so a driver token and a staff AuthenticatedUser
 * token can never be handled by the same code path. See docs/driver-auth.md.
 *
 * Unlike createAuth, there is no permissionsVersion-style staleness re-check here: a driver
 * carries no permissions to go stale, only a lifecycle status (checked fresh below on every
 * request — no existence cache yet, see docs/driver-auth.md's known gaps).
 */
export const createDriverAuth = (driverRepository: DriverRepository): RequestHandler => {
  return async (req, _res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AuthenticationError('Missing bearer token');
    }

    let decoded: AuthenticatedDriver & { purpose?: string };
    try {
      decoded = verifyToken<AuthenticatedDriver & { purpose?: string }>(token);
    } catch {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Allow-list, not a deny-list — same defense-in-depth reasoning as createAuth: every bearer
    // token this API signs shares one secret/verify path, so a driver-login-otp or
    // driver-tenant-select token (both self-obtainable, unauthenticated) must not be accepted
    // here just because it verifies. Same generic message on every failure branch below, so a
    // caller can't tell which check failed.
    if (decoded.purpose !== 'driver-access') {
      throw new AuthenticationError('Invalid or expired token');
    }

    if (await isTokenBlocked(decoded.jti)) {
      throw new AuthenticationError('Token has been revoked');
    }

    const driver = await driverRepository.findById(decoded.tenantId, decoded.id);
    if (!driver || driver.status !== 'active') {
      throw new AuthenticationError('Driver no longer active');
    }

    req.driver = decoded;
    next();
  };
};
