import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { ADMIN_ORGANIZATIONS_MANAGE } from '../../shared/constants/permissions';
import { AdminController } from './admin.controller';
import { adminValidators } from './admin.validators';

export function createAdminRoutes(controller: AdminController): Router {
  const router = Router();

  // Everything in this module is cross-tenant — platform_admin only, no exceptions.
  router.use(requirePermission(ADMIN_ORGANIZATIONS_MANAGE));

  router.get('/organizations', validate(adminValidators.listOrganizations), asyncHandler(controller.listOrganizations));
  router.get(
    '/organizations/:organizationId',
    validate(adminValidators.getOrganization),
    asyncHandler(controller.getOrganization),
  );
  
  router.patch(
    '/organizations/:organizationId',
    validate(adminValidators.updateOrganization),
    asyncHandler(controller.updateOrganization),
  );

  router.post('/staff', validate(adminValidators.createStaff), asyncHandler(controller.createStaff));
  router.get('/staff', validate(adminValidators.listStaff), asyncHandler(controller.listStaff));

  return router;
}
