import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { DriverPortalController } from './driver-portal.controller';
import { driverPortalValidators } from './driver-portal.validators';

// Mounted at /v1/driver-portal — driver-app self-service only, gated by createDriverAuth (built
// in index.ts, where DriverRepository is already constructed — routes files don't import
// repositories directly, see boundaries/dependencies); driver routers sit in their own
// pre-authMiddleware tier, see app.ts/composition-root.ts. No
// createTenantScope/requireTenant/requirePermission: a driver's tenantId is always present on
// their own token, and there is no permission matrix to check — self-scoping is the whole
// authorization model. See docs/driver-auth.md.
export function createDriverPortalRoutes(
  controller: DriverPortalController,
  driverAuth: RequestHandler,
): Router {
  const router = Router();

  router.use(driverAuth);

  router.get('/me', asyncHandler(controller.getMe));
  router.get('/me/status', asyncHandler(controller.getMyStatus));
  router.patch(
    '/me/status',
    validate(driverPortalValidators.updateMyStatus),
    asyncHandler(controller.updateMyStatus),
  );
  router.get('/me/trip-metrics', asyncHandler(controller.getMyTripMetrics));
  router.get(
    '/me/loads',
    validate(driverPortalValidators.listMyLoads),
    asyncHandler(controller.getMyLoads),
  );

  return router;
}
