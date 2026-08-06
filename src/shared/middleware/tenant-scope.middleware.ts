import { RequestHandler } from 'express';
import { TenancyGateway } from '../tenancy/tenancy.gateway';
import { AuthorizationError } from '../errors';
import { PLATFORM_SCOPE_ROLES } from '../constants/roles';

export const createTenantScope = (tenancyGateway: TenancyGateway): RequestHandler => {
  return async (req, _res, next) => {
    // Every platform-scope role (platform_admin, sales, online/offline_kyc_desk, load_console) is
    // never tenant-scoped by design — tenantId is always null for all of them, not just
    // platform_admin. Without this, any staff account created via POST /admin/staff would hit the
    // exact same "Missing tenant context" wall platform_admin did before this bypass existed.
    if (req.user?.role && PLATFORM_SCOPE_ROLES.includes(req.user.role)) {
      next();
      return;
    }

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new AuthorizationError('Missing tenant context');
    }

    const headerTenantId = req.header('X-Tenant-Id');
    if (headerTenantId && headerTenantId !== tenantId) {
      throw new AuthorizationError('Tenant mismatch');
    }

    await tenancyGateway.assertTenantActive(tenantId);
    next();
  };
};
