import { RequestHandler } from 'express';
import { AuthorizationError } from '../errors';
import { PLATFORM_ADMIN_ROLE } from '../constants/roles';

/** platform_admin is a superuser: it satisfies every requirePermission(...) check without
 *  needing the permission listed in its role_permissions rows — same implicit bypass
 *  requireRole(...) had, kept code-level rather than as seed data so it never needs updating
 *  when a new permission key is added. */
export const requirePermission = (...permissions: string[]): RequestHandler => {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      throw new AuthorizationError('Insufficient permissions');
    }
    if (user.role === PLATFORM_ADMIN_ROLE) {
      next();
      return;
    }
    if (!permissions.some((permission) => user.permissions.includes(permission))) {
      throw new AuthorizationError('Insufficient permissions');
    }
    next();
  };
};
