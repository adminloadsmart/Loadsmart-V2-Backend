import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { AuthenticatedDriver } from './request.types';
import { extractBearerToken, verifyToken } from '../utils/token';
import { isTokenBlocked } from '../utils/token-blocklist';
import { DriverRepository } from '../../modules/driver/driver.repository';
import { DriverTenantRelationRepository } from '../../modules/driver/driver-tenant-relation.repository';

/**
 * The driver-app counterpart to auth.middleware.ts's createAuth — deliberately a separate
 * middleware, not a branch inside createAuth, so a driver token and a staff AuthenticatedUser
 * token can never be handled by the same code path. See docs/driver-auth.md.
 *
 * Unlike createAuth, there is no permissionsVersion-style staleness re-check here: a driver
 * carries no permissions to go stale, only a lifecycle status (checked fresh below on every
 * request — no existence cache yet, see docs/driver-auth.md's known gaps).
 *
 * `requireTenant` gates which token purposes are accepted: tenant-scoped routes (the driver
 * portal) require `purpose: 'driver-access'` and an active tenant relation; identity-level routes
 * (managing relations across tenants) accept either that or `purpose: 'driver-identity-access'`,
 * since a driver with zero or not-yet-selected active relations still needs to reach them.
 */
export const createDriverAuth = (
  driverRepository: DriverRepository,
  driverTenantRelationRepository: DriverTenantRelationRepository,
  options: { requireTenant: boolean } = { requireTenant: true },
): RequestHandler => {
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
    const allowedPurposes = options.requireTenant
      ? ['driver-access']
      : ['driver-access', 'driver-identity-access'];
    if (!decoded.purpose || !allowedPurposes.includes(decoded.purpose)) {
      throw new AuthenticationError('Invalid or expired token');
    }

    if (await isTokenBlocked(decoded.jti)) {
      throw new AuthenticationError('Token has been revoked');
    }

    const driver = await driverRepository.findById(decoded.id);
    if (!driver) {
      throw new AuthenticationError('Driver no longer active');
    }

    if (decoded.tenantId) {
      const relation = await driverTenantRelationRepository.findByTenantAndDriver(
        decoded.tenantId,
        decoded.id,
      );
      if (!relation || relation.status !== 'active') {
        throw new AuthenticationError('Driver no longer active');
      }
    } else if (options.requireTenant) {
      throw new AuthenticationError('Invalid or expired token');
    }

    req.driver = decoded;
    next();
  };
};
