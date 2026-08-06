import { Request, RequestHandler } from 'express';
import { AuthorizationError } from '../errors';

/** For routers that represent tenant-owned resources exclusively (masters data, and future
 *  modules like it). tenant-scope.middleware.ts exempts every platform-scope role
 *  (platform_admin, staff) from its tenant check by design — correct for /roles and /admin,
 *  which platform-scope users legitimately need — but a router like masters has no legitimate
 *  platform-scope caller at all: reads would otherwise silently return an empty set (querying
 *  tenant_id IS NULL against a NOT NULL column) and writes would 500 on the DB's NOT NULL
 *  constraint instead of cleanly 403ing. Apply at the top of any such router. */
export const requireTenant: RequestHandler = (req, _res, next) => {
  if (!req.user?.tenantId) {
    throw new AuthorizationError('This resource requires an organization context');
  }
  next();
};

/** Non-null accessor for req.user.tenantId — only safe in a route handler that sits behind
 *  requireTenant above (or is otherwise already guaranteed a real tenant). Centralizes the one
 *  non-null assertion AuthenticatedUser's honestly-nullable tenantId type requires, instead of
 *  repeating `req.user!.tenantId!` at every call site. */
export function requireTenantId(req: Request): string {
  return req.user!.tenantId!;
}
