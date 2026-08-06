import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { RoleController } from './role.controller';
import { roleValidators } from './role.validators';

// Mounted post-tenantScope (see composition-root.ts's `routers` array) — assignRole/grantPermission/
// revokePermission need req.user.tenantId to be real for role.service.ts's assertCanManage to check
// org_admin's own-org-only rule. No requirePermission gate here: authorization is contextual
// (acting role + target user's org + thing's scope), handled inside the service.
export function createRoleRoutes(controller: RoleController): Router {
  const router = Router();

  router.get('/', validate(roleValidators.listRoles), asyncHandler(controller.listRoles));
  router.get('/permissions', validate(roleValidators.listPermissions), asyncHandler(controller.listPermissions));

  router.get(
    '/users/:userId/permissions',
    validate(roleValidators.getUserPermissions),
    asyncHandler(controller.getUserPermissions),
  );
  router.patch(
    '/users/:userId/role',
    validate(roleValidators.assignRole),
    asyncHandler(controller.assignRole),
  );
  router.post(
    '/users/:userId/permissions',
    validate(roleValidators.grantPermission),
    asyncHandler(controller.grantPermission),
  );
  router.delete(
    '/users/:userId/permissions/:permissionId',
    validate(roleValidators.revokePermission),
    asyncHandler(controller.revokePermission),
  );

  return router;
}
