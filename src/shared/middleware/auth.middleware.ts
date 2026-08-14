import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { AuthenticatedUser } from './request.types';
import { extractBearerToken, verifyToken } from '../utils/token';
import { isTokenBlocked } from '../utils/token-blocklist';
import { getCachedUserExists, setCachedUserExists } from '../utils/user-existence-cache';
import {
  getCachedPermissionsVersion,
  setCachedPermissionsVersion,
} from '../utils/permissions-version-cache';
import { AuthRepository } from '../../modules/auth/auth.repository';

export const createAuth = (authRepository: AuthRepository): RequestHandler => {
  return async (req, _res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AuthenticationError('Missing bearer token');
    }

    let decoded: AuthenticatedUser & { purpose?: string };
    try {
      decoded = verifyToken<AuthenticatedUser & { purpose?: string }>(token);
    } catch {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Every bearer token this API signs shares one secret/verify path (signup tokens, access
    // tokens, ...) — without this check a self-obtainable signup-purpose token (POST /auth/signup
    // requires no auth) would pass signature verification and be trusted as req.user with every
    // field undefined. Allow-list, not a signup-specific deny-list, so it fails closed against
    // any other token purpose added later. Same generic message as the catch above — don't give
    // an attacker an oracle for which check failed.
    if (decoded.purpose !== 'access') {
      throw new AuthenticationError('Invalid or expired token');
    }

    if (await isTokenBlocked(decoded.jti)) {
      throw new AuthenticationError('Token has been revoked');
    }

    let exists = await getCachedUserExists(decoded.id);
    let currentVersion = await getCachedPermissionsVersion(decoded.id);

    if (exists === null || currentVersion === null) {
      const user = await authRepository.findUserById(decoded.id);
      exists = user !== null;
      await setCachedUserExists(decoded.id, exists);
      if (user) {
        currentVersion = user.permissionsVersion;
        await setCachedPermissionsVersion(decoded.id, user.permissionsVersion);
      }
    }

    if (!exists) {
      throw new AuthenticationError('User no longer exists');
    }

    // A role/permission change (role.service.ts's assignRole/grantPermission/revokePermission)
    // bumps the DB's permissions_version and actively overwrites this cache entry, so a
    // mismatch here means this token's claims are stale — same generic message as the other
    // failure branches above, so a caller can't tell which check failed.
    if (decoded.permissionsVersion !== currentVersion) {
      throw new AuthenticationError('Invalid or expired token');
    }

    req.user = decoded;
    next();
  };
};
