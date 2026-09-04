import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { SETTLEMENTS_MANAGE } from '../../shared/constants/permissions';
import { PaymentsController } from './payments.controller';
import { transporterSettlementValidators } from './transporter-settlement.validators';
import { transporterPayablesValidators } from './transporter-payables.validators';

export function createPaymentsRoutes(controller: PaymentsController): Router {
  const router = Router();

  // Tenant-owned resources only — same as loads.routes.ts/masters.routes.ts.
  router.use(requireTenant);

  const canManageSettlements = requirePermission(SETTLEMENTS_MANAGE);

  // --- Transporter payables dashboard — Accounts. Read-only, no extra permission gate beyond
  // requireTenant above, same as GET /loads/:loadId/payments and every other read-only list
  // route; "Record payment" isn't a route here at all — it's POST /loads/:loadId/payments/balance
  // (loads.routes.ts), already gated by PAYMENTS_MANAGE there. ---
  router.get(
    '/transporter-payables',
    validate(transporterPayablesValidators.dashboard),
    asyncHandler(controller.getTransporterPayablesDashboard),
  );
  router.get(
    '/transporter-payables/:transporterId/loads',
    validate(transporterPayablesValidators.transporterLoads),
    asyncHandler(controller.getTransporterPayableLoads),
  );

  // --- Transporter settlements ---
  router.get(
    '/transporter-settlements/:loadId/summary',
    validate(transporterSettlementValidators.summary),
    asyncHandler(controller.getTransporterSettlementSummary),
  );
  router.post(
    '/transporter-settlements/:loadId',
    canManageSettlements,
    validate(transporterSettlementValidators.record),
    asyncHandler(controller.recordTransporterSettlement),
  );

  return router;
}
