import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { requireTenant } from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { ShipperAnalyticsController } from './shipper-analytics.controller';
import { shipperAnalyticsValidators as validators } from './shipper-analytics.validators';

/** Shipper Analytics (Metric Guide v1.0): the filter options and one endpoint per tab. */
export function createShipperAnalyticsRoutes(controller: ShipperAnalyticsController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get(
    '/shipper/filters',
    validate(validators.getFilters),
    asyncHandler(controller.getFilters),
  );
  router.get(
    '/shipper/overview',
    validate(validators.getOverview),
    asyncHandler(controller.getOverview),
  );
  router.get(
    '/shipper/freight-spend',
    validate(validators.getFreightSpend),
    asyncHandler(controller.getFreightSpend),
  );
  router.get(
    '/shipper/transporters',
    validate(validators.getTransporters),
    asyncHandler(controller.getTransporters),
  );
  router.get(
    '/shipper/service',
    validate(validators.getService),
    asyncHandler(controller.getService),
  );
  router.get(
    '/shipper/billing',
    validate(validators.getBilling),
    asyncHandler(controller.getBilling),
  );
  return router;
}
