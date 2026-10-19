import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { GEOFENCES_MANAGE } from '../../shared/constants/permissions';
import { GeofencesController } from './geofences.controller';
import { geofenceValidators } from './geofence.validators';

export function createGeofencesRoutes(controller: GeofencesController): Router {
  const router = Router();

  // Tenant-owned resources only — same as masters.routes.ts / loads.routes.ts.
  router.use(requireTenant);

  const canManage = requirePermission(GEOFENCES_MANAGE);

  router.post('/', canManage, validate(geofenceValidators.create), asyncHandler(controller.create));
  router.get('/', validate(geofenceValidators.list), asyncHandler(controller.list));
  router.get('/:geofenceId', validate(geofenceValidators.get), asyncHandler(controller.get));
  router.patch(
    '/:geofenceId',
    canManage,
    validate(geofenceValidators.update),
    asyncHandler(controller.update),
  );
  router.delete(
    '/:geofenceId',
    canManage,
    validate(geofenceValidators.delete),
    asyncHandler(controller.delete),
  );

  return router;
}
