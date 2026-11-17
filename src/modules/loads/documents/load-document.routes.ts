import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { LOADS_DOCUMENTS_MANAGE } from '../../../shared/constants/permissions';
import { LoadDocumentController } from './load-document.controller';
import { loadDocumentValidators as v } from './load-document.validators';

/** Mounted on the loads router (tenant already required there). Reads are open to the tenant,
 *  like the load itself; reviewing is the documents team's. */
export function createLoadDocumentRoutes(controller: LoadDocumentController): Router {
  const router = Router();
  router.get('/loads/:loadId/documents', validate(v.list), asyncHandler(controller.list));
  router.post(
    '/loads/:loadId/documents/:documentId/review',
    requirePermission(LOADS_DOCUMENTS_MANAGE),
    validate(v.review),
    asyncHandler(controller.review),
  );
  return router;
}
