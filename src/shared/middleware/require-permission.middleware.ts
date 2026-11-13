import { RequestHandler } from 'express';
import { AuthorizationError } from '../errors';
import { PLATFORM_ADMIN_ROLE } from '../constants/roles';
import { ADMIN_ORGANIZATIONS_MANAGE } from '../constants/permissions';
import { AuthenticatedUser } from './request.types';

/** The subset of AuthenticatedUser a permission decision needs — services take this rather than
 *  a bare role name, so every access/auto-approve decision reads the seeded permission bundle
 *  (role ∪ direct grants) instead of comparing role names. */
export type PermissionHolder = Pick<AuthenticatedUser, 'role' | 'permissions'>;

/** The single permission check every gate shares — requirePermission below, and any service that
 *  branches on a capability (e.g. "creator could approve it, so auto-approve"). platform_admin is
 *  a superuser: it satisfies every check without needing the permission listed in its
 *  role_permissions rows, kept code-level rather than as seed data so it never needs updating when
 *  a new permission key is added. */
export function hasPermission(user: PermissionHolder | undefined | null, key: string): boolean {
  if (!user) return false;
  return user.role === PLATFORM_ADMIN_ROLE || user.permissions.includes(key);
}

/** Platform-administrator *authority*: the platform_admin role, or a staff member platform_admin
 *  granted the admin key (ADMIN_ORGANIZATIONS_MANAGE) to directly. Use it wherever a decision is
 *  "may this caller act as platform admin"; keep checks about a TARGET's identity (is the target a
 *  platform_admin / a desk / sales) role-based. Never makes anyone able to create or change a
 *  platform_admin account — those come only from the seed script (see RoleService.assertCanManage). */
export function isPlatformAdministrator(user: PermissionHolder | undefined | null): boolean {
  if (!user) return false;
  return user.role === PLATFORM_ADMIN_ROLE || user.permissions.includes(ADMIN_ORGANIZATIONS_MANAGE);
}

/** Passes when the caller holds ANY of the listed permissions. */
export const requirePermission = (...permissions: string[]): RequestHandler => {
  return (req, _res, next) => {
    if (!permissions.some((permission) => hasPermission(req.user, permission))) {
      throw new AuthorizationError('Insufficient permissions');
    }
    next();
  };
};
