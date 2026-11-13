import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { importUpload, requireImportFile } from '../../../shared/import/upload';
import { TransporterController } from './transporter.controller';
import { transporterValidators } from './transporter.validators';
import { TransporterImportController } from './transporter-import.controller';

export function createTransporterRoutes(
  controller: TransporterController,
  transporterImportController: TransporterImportController,
): Router {
  const router = Router();
  // Writes need MASTERS_WRITE like every other master; reads are open to every tenant seat.
  const canWrite = requirePermission(MASTERS_WRITE);

  router.post(
    '/transporters',
    canWrite,
    validate(transporterValidators.createTransporter),
    asyncHandler(controller.createTransporter),
  );
  router.post(
    '/transporters/import',
    canWrite,
    importUpload,
    requireImportFile,
    asyncHandler(transporterImportController.import),
  );
  // Literal segment — declared before '/transporters/:transporterId'.
  router.get(
    '/transporters/import/sample',
    canWrite,
    asyncHandler(transporterImportController.sample),
  );
  router.get(
    '/transporters',
    validate(transporterValidators.listTransporters),
    asyncHandler(controller.listTransporters),
  );
  // Literal segment — declared before '/transporters/:transporterId'.
  router.get(
    '/transporters/export',
    canWrite,
    validate(transporterValidators.exportTransporters),
    asyncHandler(controller.exportTransporters),
  );
  router.get(
    '/transporters/:transporterId/loads',
    validate(transporterValidators.transporterLoads),
    asyncHandler(controller.listTransporterLoads),
  );
  router.get(
    '/transporters/:transporterId/usage',
    validate(transporterValidators.getTransporter),
    asyncHandler(controller.transporterUsage),
  );
  router.patch(
    '/transporters/:transporterId/status',
    canWrite,
    validate(transporterValidators.updateStatus),
    asyncHandler(controller.updateTransporterStatus),
  );
  router.get(
    '/transporters/:transporterId',
    validate(transporterValidators.getTransporter),
    asyncHandler(controller.getTransporter),
  );
  router.patch(
    '/transporters/:transporterId',
    canWrite,
    validate(transporterValidators.updateTransporter),
    asyncHandler(controller.updateTransporter),
  );
  router.delete(
    '/transporters/:transporterId',
    canWrite,
    validate(transporterValidators.deleteTransporter),
    asyncHandler(controller.deleteTransporter),
  );

  return router;
}
