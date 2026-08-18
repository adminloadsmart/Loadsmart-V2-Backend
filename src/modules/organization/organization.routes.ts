import { Router } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { ORGANIZATION_PROFILE_MANAGE } from '../../shared/constants/permissions';
import { OrganizationController } from './organization.controller';
import { organizationValidators } from './organization.validators';
import { ValidationError } from '../../shared/errors';

const organizationBusinessUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    if (!['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
      callback(new ValidationError('Only JPG, JPEG, PNG, and PDF files are accepted'));
      return;
    }
    callback(null, true);
  },
});

function requireOrganizationBusinessFiles(
  req: Parameters<import('express').RequestHandler>[0],
  _res: Parameters<import('express').RequestHandler>[1],
  next: Parameters<import('express').RequestHandler>[2],
) {
  const files = req.files as Record<string, Express.Multer.File[] | undefined>;
  // A rejected business document can be replaced without forcing the user to upload the
  // already-approved shop-premises photo again. The service still requires one when the org has
  // no existing shop-premises photo.
  const requiredFields = ['documentFront'];
  const missing = requiredFields.filter((field) => !files[field]?.[0]);
  if (missing.length) {
    next(new ValidationError(`Missing required file fields: ${missing.join(', ')}`));
    return;
  }
  next();
}

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
    organizationBusinessUpload.fields([
      { name: 'documentFront', maxCount: 1 },
      { name: 'documentBack', maxCount: 1 },
      { name: 'shopPremisesPhoto', maxCount: 1 },
    ]),
    requireOrganizationBusinessFiles,
    validate(organizationValidators.saveBusinessDetails),
    asyncHandler(controller.saveBusinessDetails),
  );
  router.post(
    '/organization/submit',
    validate(organizationValidators.submitOrganization),
    asyncHandler(controller.submitOrganization),
  );

  // Settings → Users & Roles. Gated the same way admin.routes.ts gates POST/GET /admin/staff —
  // requirePermission fails fast at the route instead of only 403ing deep inside the service.
  // ORGANIZATION_PROFILE_MANAGE is seeded onto org_admin only (see db/seed-roles.ts), so this is
  // functionally an org-admin-only gate today; auth.service.ts's inviteOrganizationUser/
  // listOrganizationUsers still assert actingUser.tenantId is real as a second, cheaper check —
  // requirePermission has no notion of tenant context, only of permission membership.
  router.post(
    '/organization/users',
    requirePermission(ORGANIZATION_PROFILE_MANAGE),
    validate(organizationValidators.inviteOrganizationUser),
    asyncHandler(controller.inviteUser),
  );
  router.get(
    '/organization/users',
    requirePermission(ORGANIZATION_PROFILE_MANAGE),
    validate(organizationValidators.listOrganizationUsers),
    asyncHandler(controller.listUsers),
  );

  // Backs the "Invite a teammate" role dropdown — exactly the 4 assignable roles (sales_cs,
  // dispatch, documents_ops, finance_accounts), not the full organization-scope catalog GET
  // /roles?scope=organization returns (which still includes org_admin and sales). See
  // role.service.ts's listAssignableOrganizationRoles.
  router.get(
    '/organization/roles',
    requirePermission(ORGANIZATION_PROFILE_MANAGE),
    asyncHandler(controller.listAssignableRoles),
  );

  return router;
}
