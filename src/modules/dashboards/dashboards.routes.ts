import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { DashboardsController } from './dashboards.controller';
import { dashboardsValidators } from './dashboards.validators';

export function createDashboardsRoutes(controller: DashboardsController): Router {
  const router = Router();

  // Tenant-owned resources only — no platform-scope caller has any business here, same
  // reasoning as masters.routes.ts.
  router.use(requireTenant);

  // Read-only summary — no canWrite gate, matching masters' GET routes.
  router.get(
    '/fleet-activity',
    validate(dashboardsValidators.getFleetActivity),
    asyncHandler(controller.getFleetActivity),
  );

  return router;
}
