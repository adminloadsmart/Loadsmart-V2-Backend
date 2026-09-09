import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import { FleetDriverLinkController } from './fleet-driver-link.controller';
import { fleetDriverLinkValidators } from './fleet-driver-link.validators';

export function createFleetDriverLinkRoutes(controller: FleetDriverLinkController): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);

  router.post(
    '/vehicles/:vehicleId/drivers',
    canWrite,
    validate(fleetDriverLinkValidators.linkDriver),
    asyncHandler(controller.linkDriver),
  );
  router.get(
    '/vehicles/:vehicleId/drivers',
    validate(fleetDriverLinkValidators.listVehicleLinks),
    asyncHandler(controller.listVehicleLinks),
  );
  router.get(
    '/drivers/:driverId/vehicles',
    validate(fleetDriverLinkValidators.listDriverLinks),
    asyncHandler(controller.listDriverLinks),
  );
  router.patch(
    '/fleet-driver-links/:linkId/primary',
    canWrite,
    validate(fleetDriverLinkValidators.setLinkPrimary),
    asyncHandler(controller.setLinkPrimary),
  );
  router.patch(
    '/fleet-driver-links/:linkId/end',
    canWrite,
    validate(fleetDriverLinkValidators.endLink),
    asyncHandler(controller.endLink),
  );
  router.delete(
    '/fleet-driver-links/:linkId',
    canWrite,
    validate(fleetDriverLinkValidators.deleteLink),
    asyncHandler(controller.deleteLink),
  );

  return router;
}
