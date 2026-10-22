import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { CUSTOMERS_CREATE } from '../../shared/constants/permissions';
import { importUpload, requireImportFile } from '../../shared/import/upload';
import { CustomerImportController } from './customer-import.controller';

export function createCustomerImportRoutes(controller: CustomerImportController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get('/sample', requirePermission(CUSTOMERS_CREATE), asyncHandler(controller.sample));
  router.post(
    '/preview',
    requirePermission(CUSTOMERS_CREATE),
    importUpload,
    requireImportFile,
    asyncHandler(controller.preview),
  );
  router.post(
    '/',
    requirePermission(CUSTOMERS_CREATE),
    importUpload,
    requireImportFile,
    asyncHandler(controller.import),
  );
  return router;
}
