import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { AnalyticsController } from './analytics.controller';

export function createAnalyticsRoutes(controller: AnalyticsController): Router {
  const router = Router();
  router.use(requireTenant);
  router.get('/shipper/overview', asyncHandler(controller.getShipperOverview));
  return router;
}
