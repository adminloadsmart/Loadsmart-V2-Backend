import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { requireTenant } from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { FleetAnalyticsController } from './fleet-analytics.controller';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';

export function createFleetAnalyticsRoutes(controller: FleetAnalyticsController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get(
    '/fleet/overview',
    validate(fleetAnalyticsValidators.getOverview),
    asyncHandler(controller.getOverview),
  );
  return router;
}
