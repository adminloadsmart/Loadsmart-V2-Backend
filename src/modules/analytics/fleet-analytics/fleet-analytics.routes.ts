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
    '/fleet/filters',
    validate(fleetAnalyticsValidators.getFilters),
    asyncHandler(controller.getFilters),
  );
  router.get(
    '/fleet/summary',
    validate(fleetAnalyticsValidators.getSummary),
    asyncHandler(controller.getSummary),
  );
  router.get(
    '/fleet/overview',
    validate(fleetAnalyticsValidators.getOverview),
    asyncHandler(controller.getOverview),
  );
  router.get(
    '/fleet/utilisation',
    validate(fleetAnalyticsValidators.getUtilisation),
    asyncHandler(controller.getUtilisation),
  );
  router.get(
    '/fleet/cost',
    validate(fleetAnalyticsValidators.getCost),
    asyncHandler(controller.getCost),
  );
  router.get(
    '/fleet/energy',
    validate(fleetAnalyticsValidators.getEnergy),
    asyncHandler(controller.getEnergy),
  );
  router.get(
    '/fleet/maintenance',
    validate(fleetAnalyticsValidators.getMaintenance),
    asyncHandler(controller.getMaintenance),
  );
  router.get(
    '/fleet/operations',
    validate(fleetAnalyticsValidators.getOperations),
    asyncHandler(controller.getOperations),
  );
  router.get(
    '/fleet/compliance',
    validate(fleetAnalyticsValidators.getCompliance),
    asyncHandler(controller.getCompliance),
  );
  return router;
}
