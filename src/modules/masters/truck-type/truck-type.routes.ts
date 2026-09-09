import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { TruckTypeController } from './truck-type.controller';
import { truckTypeValidators } from './truck-type.validators';

export function createTruckTypeRoutes(controller: TruckTypeController): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);

  // Settings → Truck Types — vehicles.truckTypeId references these, so declared first.
  // /truck-types/catalog before /truck-types/:truckTypeId so the literal segment isn't captured
  // as an id (there's no GET /truck-types/:id today, but keeping the convention cheap now beats
  // a collision surprise if one gets added later).
  router.get(
    '/truck-types/catalog',
    validate(truckTypeValidators.listTruckTypeCatalog),
    asyncHandler(controller.listTruckTypeCatalog),
  );
  router.post(
    '/truck-types/from-catalog',
    canWrite,
    validate(truckTypeValidators.addTruckTypesFromCatalog),
    asyncHandler(controller.addTruckTypesFromCatalog),
  );
  router.post(
    '/truck-types/resolve',
    canWrite,
    validate(truckTypeValidators.resolveTruckType),
    asyncHandler(controller.resolveTruckType),
  );
  router.get(
    '/truck-types',
    validate(truckTypeValidators.listTruckTypes),
    asyncHandler(controller.listTruckTypes),
  );
  router.post(
    '/truck-types',
    canWrite,
    validate(truckTypeValidators.createTruckType),
    asyncHandler(controller.createTruckType),
  );
  router.delete(
    '/truck-types/:truckTypeId',
    canWrite,
    validate(truckTypeValidators.deleteTruckType),
    asyncHandler(controller.deleteTruckType),
  );

  return router;
}
