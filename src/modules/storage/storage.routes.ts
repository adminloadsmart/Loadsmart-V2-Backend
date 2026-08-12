import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { FILES_DELETE, FILES_READ, FILES_UPLOAD } from '../../shared/constants/permissions';
import { StorageController } from './storage.controller';
import { storageValidators } from './storage.validators';

// Unlike most tenant-owned-resource routers, requireTenant is NOT applied router-wide here: the
// platform_admin read bypass (see storage.service.ts's get()) means GET /:fileId must stay
// reachable for a caller with no tenant at all. Apply requireTenant per-route instead, only on
// the writes, which stay tenant-owned-only.
export function createStorageRoutes(controller: StorageController): Router {
  const router = Router();

  router.post(
    '/',
    requireTenant,
    requirePermission(FILES_UPLOAD),
    validate(storageValidators.generateUploadUrl),
    asyncHandler(controller.generateUploadUrl),
  );
  router.post(
    '/:fileId/confirm',
    requireTenant,
    requirePermission(FILES_UPLOAD),
    validate(storageValidators.confirmUpload),
    asyncHandler(controller.confirmUpload),
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
