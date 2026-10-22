import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { importUpload, requireImportFile } from '../../../shared/import/upload';
import { ContractController } from './contract.controller';
import { contractValidators } from './contract.validators';

// Settings → Masters → Contracts. Reads are open to every tenant seat (dispatch needs the
// rankings); writes need masters.write and the service further restricts them to org_admin.
export function createContractRoutes(controller: ContractController): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);

  router.post(
    '/contracts',
    canWrite,
    validate(contractValidators.create),
    asyncHandler(controller.create),
  );
  router.get('/contracts', validate(contractValidators.list), asyncHandler(controller.list));
  // Literal segments — declared before '/contracts/:contractId'.
  router.get(
    '/contracts/lane-allocation',
    validate(contractValidators.laneAllocation),
    asyncHandler(controller.laneAllocation),
  );
  router.get(
    '/contracts/export',
    validate(contractValidators.export),
    asyncHandler(controller.export),
  );
  router.post(
    '/contracts/import',
    canWrite,
    importUpload,
    requireImportFile,
    asyncHandler(controller.import),
  );
  // Literal segment — declared before '/contracts/:contractId'.
  router.get('/contracts/import/sample', canWrite, asyncHandler(controller.importSample));
  router.get(
    '/contracts/:contractId',
    validate(contractValidators.get),
    asyncHandler(controller.get),
  );
  router.patch(
    '/contracts/:contractId',
    canWrite,
    validate(contractValidators.update),
    asyncHandler(controller.update),
  );
  router.delete(
    '/contracts/:contractId',
    canWrite,
    validate(contractValidators.delete),
    asyncHandler(controller.delete),
  );
  return router;
}
