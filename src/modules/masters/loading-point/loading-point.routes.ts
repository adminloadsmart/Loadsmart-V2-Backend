import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { mastersExcelUpload, requireMastersExcelFile } from '../masters.upload';
import { LoadingPointController } from './loading-point.controller';
import { loadingPointValidators } from './loading-point.validators';
import { LoadingPointImportController } from './loading-point-import.controller';

export function createLoadingPointRoutes(
  controller: LoadingPointController,
  loadingPointImportController: LoadingPointImportController,
): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);
  const canApprove = requirePermission(MASTERS_APPROVE);

  // Settings → Loading Points — origins used by dispatch and load creation.
  router.post(
    '/loading-points/import',
    canWrite,
    mastersExcelUpload.single('file'),
    requireMastersExcelFile,
    asyncHandler(loadingPointImportController.import),
  );
  router.post(
    '/loading-points',
    canWrite,
    validate(loadingPointValidators.create),
    asyncHandler(controller.createLoadingPoint),
  );
  router.get(
    '/loading-points',
    validate(loadingPointValidators.list),
    asyncHandler(controller.listLoadingPoints),
  );
  // Distinct cities with at least one loading point — feeds the city filter dropdown. Declared
  // before '/loading-points/:loadingPointId' so the literal segment isn't captured as an id.
  router.get(
    '/loading-points/cities',
    validate(loadingPointValidators.listCities),
    asyncHandler(controller.listLoadingPointCities),
  );
  router.get(
    '/loading-points/:loadingPointId',
    validate(loadingPointValidators.get),
    asyncHandler(controller.getLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId',
    canWrite,
    validate(loadingPointValidators.update),
    asyncHandler(controller.updateLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId/approve',
    canApprove,
    validate(loadingPointValidators.approve),
    asyncHandler(controller.approveLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId/reject',
    canApprove,
    validate(loadingPointValidators.reject),
    asyncHandler(controller.rejectLoadingPoint),
  );
  router.delete(
    '/loading-points/:loadingPointId',
    canWrite,
    validate(loadingPointValidators.delete),
    asyncHandler(controller.deleteLoadingPoint),
  );

  return router;
}
