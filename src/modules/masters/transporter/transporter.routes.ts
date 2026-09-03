import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { mastersExcelUpload, requireMastersExcelFile } from '../masters.upload';
import { TransporterController } from './transporter.controller';
import { transporterValidators } from './transporter.validators';
import { TransporterImportController } from './transporter-import.controller';

export function createTransporterRoutes(
  controller: TransporterController,
  transporterImportController: TransporterImportController,
): Router {
  const router = Router();

  router.post(
    '/transporters',
    validate(transporterValidators.createTransporter),
    asyncHandler(controller.createTransporter),
  );
  router.post(
    '/transporters/import',
    requirePermission(MASTERS_WRITE),
    mastersExcelUpload.single('file'),
    requireMastersExcelFile,
    asyncHandler(transporterImportController.import),
  );
  router.get(
    '/transporters',
    validate(transporterValidators.listTransporters),
    asyncHandler(controller.listTransporters),
  );
  router.get(
    '/transporters/:transporterId',
    validate(transporterValidators.getTransporter),
    asyncHandler(controller.getTransporter),
  );
  router.patch(
    '/transporters/:transporterId',
    validate(transporterValidators.updateTransporter),
    asyncHandler(controller.updateTransporter),
  );
  router.delete(
    '/transporters/:transporterId',
    validate(transporterValidators.deleteTransporter),
    asyncHandler(controller.deleteTransporter),
  );

  return router;
}
