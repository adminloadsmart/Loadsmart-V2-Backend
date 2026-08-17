import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import {
  REQUISITIONS_MANAGE,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { LoadsController } from './loads.controller';
import { requisitionValidators } from './requisition.validators';
import { dispatchPlanningValidators } from './dispatch-planning.validators';
import { loadValidators } from './load.validators';
import { loadPaymentValidators } from './load-payment.validators';

export function createLoadsProtectedRoutes(controller: LoadsController): Router {
  const router = Router();

  // Tenant-owned resources only — no platform-scope caller has any business here, same as
  // masters.routes.ts.
  router.use(requireTenant);

  const canManageRequisitions = requirePermission(REQUISITIONS_MANAGE);
  const canManageDispatch = requirePermission(DISPATCH_PLANNING_MANAGE);
  const canManageDocuments = requirePermission(LOADS_DOCUMENTS_MANAGE);
  const canManagePayments = requirePermission(PAYMENTS_MANAGE);

  // --- Requisitions (§6.2) ---
  router.post(
    '/requisitions',
    canManageRequisitions,
    validate(requisitionValidators.create),
    asyncHandler(controller.createRequisition),
  );
  router.get(
    '/requisitions',
    validate(requisitionValidators.list),
    asyncHandler(controller.listRequisitions),
  );
  router.get(
    '/requisitions/:requisitionId',
    validate(requisitionValidators.get),
    asyncHandler(controller.getRequisition),
  );
  router.patch(
    '/requisitions/:requisitionId/close',
    canManageRequisitions,
    validate(requisitionValidators.close),
    asyncHandler(controller.closeRequisition),
  );

  // --- Dispatch Planning (§6.3) — splits a requisition into one Load per planned truck. ---
  router.post(
    '/requisitions/:requisitionId/dispatch-plan',
    canManageDispatch,
    validate(dispatchPlanningValidators.plan),
    asyncHandler(controller.planDispatch),
  );

  // --- Loads (§6.4-§6.9, §6.11) ---
  router.get('/loads', validate(loadValidators.list), asyncHandler(controller.listLoads));
  router.get('/loads/:loadId', validate(loadValidators.get), asyncHandler(controller.getLoad));
  router.get(
    '/loads/:loadId/activities',
    validate(loadValidators.getActivities),
    asyncHandler(controller.listLoadActivities),
  );

  // Load Assignment (§6.4) — vehicle/driver (own-fleet) or freight terms (market).
  router.patch(
    '/loads/:loadId/assign',
    canManageDispatch,
    validate(loadValidators.assign),
    asyncHandler(controller.assignLoad),
  );

  // Loading & Documents (§6.5) and Tracking/E-POD (§6.7/§6.8) — Ops.
  router.patch(
    '/loads/:loadId/confirm-loading',
    canManageDocuments,
    validate(loadValidators.confirmLoading),
    asyncHandler(controller.confirmLoading),
  );
  router.patch(
    '/loads/:loadId/status',
    canManageDocuments,
    validate(loadValidators.updateStatus),
    asyncHandler(controller.updateLoadStatus),
  );
  router.patch(
    '/loads/:loadId/pod',
    canManageDocuments,
    validate(loadValidators.uploadPod),
    asyncHandler(controller.uploadPod),
  );

  // --- Payments (§6.6/§6.9) — Accounts. ---
  router.post(
    '/loads/:loadId/payments/advance',
    canManagePayments,
    validate(loadPaymentValidators.recordAdvance),
    asyncHandler(controller.recordAdvancePayment),
  );
  router.post(
    '/loads/:loadId/payments/balance',
    canManagePayments,
    validate(loadPaymentValidators.recordBalance),
    asyncHandler(controller.recordBalancePayment),
  );
  router.get(
    '/loads/:loadId/payments',
    validate(loadPaymentValidators.list),
    asyncHandler(controller.listLoadPayments),
  );

  return router;
}
