import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { mastersExcelUpload, requireMastersExcelFile } from '../masters.upload';
import { TransporterContractController } from './transporter-contract.controller';
import { TransporterContractImportController } from './transporter-contract-import.controller';
import { transporterContractValidators } from './transporter-contract.validators';

export function createTransporterContractRoutes(
  controller: TransporterContractController,
  importController: TransporterContractImportController,
): Router {
  const router = Router();

  router.post(
    '/transporter-contracts',
    requirePermission(MASTERS_WRITE),
    validate(transporterContractValidators.createContract),
    asyncHandler(controller.createContract),
  );
  router.post(
    '/transporter-contracts/import',
    requirePermission(MASTERS_WRITE),
    mastersExcelUpload.single('file'),
    requireMastersExcelFile,
    asyncHandler(importController.import),
  );
  router.get(
    '/transporter-contracts',
    validate(transporterContractValidators.listContracts),
    asyncHandler(controller.listContracts),
  );
  // Static segments before '/:contractId' so they are not read as an id.
  router.get(
    '/transporter-contracts/lane-summary',
    validate(transporterContractValidators.laneSummary),
    asyncHandler(controller.laneSummary),
  );
  router.get(
    '/transporter-contracts/:contractId',
    validate(transporterContractValidators.getContract),
    asyncHandler(controller.getContract),
  );
  router.patch(
    '/transporter-contracts/:contractId',
    requirePermission(MASTERS_WRITE),
    validate(transporterContractValidators.updateContract),
    asyncHandler(controller.updateContract),
  );
  router.delete(
    '/transporter-contracts/:contractId',
    requirePermission(MASTERS_WRITE),
    validate(transporterContractValidators.deleteContract),
    asyncHandler(controller.deleteContract),
  );
  router.get(
    '/customers/:customerId/transporter-contracts',
    validate(transporterContractValidators.customerContracts),
    asyncHandler(controller.customerContracts),
  );

  return router;
}
