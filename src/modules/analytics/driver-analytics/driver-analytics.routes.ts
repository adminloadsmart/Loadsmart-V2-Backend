import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { requireTenant } from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { DriverAnalyticsController } from './driver-analytics.controller';
import { driverAnalyticsValidators } from './driver-analytics.validators';

export function createDriverAnalyticsRoutes(controller: DriverAnalyticsController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get(
    '/drivers/:driverId/overview',
    validate(driverAnalyticsValidators.getOverview),
    asyncHandler(controller.getOverview),
  );
  return router;
}
