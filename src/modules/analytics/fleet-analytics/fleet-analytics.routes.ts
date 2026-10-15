import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { requireTenant } from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MAINTENANCE_COSTS_VIEW } from '../../../shared/constants/permissions';
import { FleetAnalyticsController } from './fleet-analytics.controller';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';

/**
 * §5.14: Fleet Analytics is only visible to seats allowed to see money, so every tab that carries
 * cost sits behind maintenance.costs.view. The filter options, operations (load movement, no
 * money) and compliance (papers and licences, with its one money column dropped for other
 * seats) stay open.
 */
export function createFleetAnalyticsRoutes(controller: FleetAnalyticsController): Router {
  const router = Router();
  const canSeeMoney = requirePermission(MAINTENANCE_COSTS_VIEW);
  router.use(requireTenant);
  router.get(
    '/fleet/filters',
    validate(fleetAnalyticsValidators.getFilters),
    asyncHandler(controller.getFilters),
  );
  router.get(
    '/fleet/summary',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getSummary),
    asyncHandler(controller.getSummary),
  );
  router.get(
    '/fleet/overview',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getOverview),
    asyncHandler(controller.getOverview),
  );
  router.get(
    '/fleet/utilisation',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getUtilisation),
    asyncHandler(controller.getUtilisation),
  );
  router.get(
    '/fleet/cost',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getCost),
    asyncHandler(controller.getCost),
  );
  router.get(
    '/fleet/energy',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getEnergy),
    asyncHandler(controller.getEnergy),
  );
  router.get(
    '/fleet/maintenance',
    canSeeMoney,
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
  router.get(
    '/fleet/findings',
    canSeeMoney,
    validate(fleetAnalyticsValidators.getFindings),
    asyncHandler(controller.getFindings),
  );
  return router;
}
