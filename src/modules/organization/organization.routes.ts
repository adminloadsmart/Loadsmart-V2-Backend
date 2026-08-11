import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { OrganizationController } from './organization.controller';
import { organizationValidators } from './organization.validators';

// Mounted at '/auth' by composition-root.ts (see createOrganizationOnboardingRoutes in
// index.ts), alongside modules/auth/'s own protectedRouter — the routes here keep their existing
// /auth/organization* URLs even though the code now lives in modules/organization/. No auth
// middleware applied here: like auth.routes.ts's protected router, this relies on the global
// authMiddleware tier in app.ts that already runs ahead of every authenticatedRouters entry.
export function createOrganizationOnboardingRoutes(controller: OrganizationController): Router {
  const router = Router();

  router.get('/organization', asyncHandler(controller.getOrganization));
  router.post(
    '/organization',
    validate(organizationValidators.createOrganization),
    asyncHandler(controller.createOrganization),
  );
  router.post(
    '/organization/business',
    validate(organizationValidators.saveBusinessDetails),
    asyncHandler(controller.saveBusinessDetails),
  );
  router.post(
    '/organization/submit',
    validate(organizationValidators.submitOrganization),
    asyncHandler(controller.submitOrganization),
  );

  // Settings → Users & Roles. Org-admin-only (enforced service-side, not by a route-level
  // permission — see auth.service.ts's inviteOrganizationUser), same reasoning role.service.ts's
  // assertCanManage already uses a hardcoded ORG_ADMIN_ROLE check for this kind of
  // authority-over-other-users action instead of a dedicated permission key.
  router.post(
    '/organization/users',
    validate(organizationValidators.inviteOrganizationUser),
    asyncHandler(controller.inviteUser),
  );
  router.get(
    '/organization/users',
    validate(organizationValidators.listOrganizationUsers),
    asyncHandler(controller.listUsers),
  );

  return router;
}
