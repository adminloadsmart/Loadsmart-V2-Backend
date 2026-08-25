import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { requireTenant } from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { ShipperAnalyticsController } from './shipper-analytics.controller';
import { shipperAnalyticsValidators } from './shipper-analytics.validators';

export function createShipperAnalyticsRoutes(controller: ShipperAnalyticsController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get(
    '/shipper/overview',
    validate(shipperAnalyticsValidators.getOverview),
    asyncHandler(controller.getOverview),
  );
  return router;
}
