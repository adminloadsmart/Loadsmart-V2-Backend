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

  return router;
}
