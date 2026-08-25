import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { FILES_DELETE, FILES_READ, FILES_UPLOAD } from '../../shared/constants/permissions';
import { StorageController } from './storage.controller';
import { storageValidators } from './storage.validators';

// Unlike most tenant-owned-resource routers, requireTenant is NOT applied router-wide here.
// GET /:fileId has never had it (platform-scope read bypass — see storage.service.ts's get()).
// POST / and POST /:fileId/confirm don't have it either: PLATFORM_SCOPE_ROLES (sales,
// online/offline_kyc_desk, load_console) already pass the *global* tenant-scope middleware with
// no tenant of their own (see tenant-scope.middleware.ts), and storage.service.ts/
// storage.repository.ts are tenant-null-safe end to end — a local requireTenant here would only
// re-block exactly the callers the global middleware already deliberately let through. A
// pre-org-creation org_admin (also tenant-less) never reaches this router at all — the global
// tenant-scope middleware still rejects it, by design (not yet supported — no concrete need for
// it today).
// A tenant-having org_admin whose org is still draft/pending/partial_pending (not yet approved)
// *can* reach POST / and POST /:fileId/confirm — TenancyGatewayLocal carries an explicit
// exemption for exactly these two routes so onboarding uploads (e.g. business/KYC documents)
// aren't blocked until admin approval. GET routes were never subject to the approval gate at all
// (reads only need isTenantAccessible). DELETE /:fileId keeps requireTenant and gets no such
// exemption: deleting stays tenant-owned-only and approval-gated, no tenant-less or unapproved
// caller of any kind may use it.
export function createStorageRoutes(controller: StorageController): Router {
  const router = Router();

  router.post(
    '/',
    requirePermission(FILES_UPLOAD),
    validate(storageValidators.generateUploadUrl),
    asyncHandler(controller.generateUploadUrl),
  );
  router.post(
    '/:fileId/confirm',
    requirePermission(FILES_UPLOAD),
    validate(storageValidators.confirmUpload),
    asyncHandler(controller.confirmUpload),
  );
  // Registered before /:fileId — Express matches route registration order, and :fileId (a
  // single path segment) would otherwise swallow a request to /by-key before it ever reaches
  // this handler.
  router.get(
    '/by-key',
    requirePermission(FILES_READ),
    validate(storageValidators.getByKey),
    asyncHandler(controller.getByKey),
  );
  router.get(
    '/:fileId',
    requirePermission(FILES_READ),
    validate(storageValidators.get),
    asyncHandler(controller.get),
  );
  router.delete(
    '/:fileId',
    requireTenant,
    requirePermission(FILES_DELETE),
    validate(storageValidators.remove),
    asyncHandler(controller.remove),
  );

  return router;
}
