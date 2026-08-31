import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { CUSTOMERS_APPROVE, MASTERS_APPROVE } from '../../shared/constants/permissions';
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

  // Home screen: trip counts + loads/tonnes-shipped/freight-spend per-day series. Read-only, no
  // canWrite gate — same reasoning as fleet-activity above.
  router.get(
    '/loads-summary',
    validate(dashboardsValidators.getLoadsSummary),
    asyncHandler(controller.getLoadsSummary),
  );

  // Settings → Approvals. Either permission grants visibility — both are org_admin-only today
  // (see db/seed-roles.ts), matching who can act on what this endpoint lists.
  router.get(
    '/pending-approvals',
    requirePermission(CUSTOMERS_APPROVE, MASTERS_APPROVE),
    asyncHandler(controller.listPendingApprovals),
  );

  return router;
}
