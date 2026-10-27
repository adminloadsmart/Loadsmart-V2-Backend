import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { DISPATCH_PLANNING_MANAGE } from '../../shared/constants/permissions';
import { LoadSourcingController } from './load-sourcing.controller';
import { loadSourcingValidators as v } from './load-sourcing.validators';

/** Mounted on the loads router (tenant already required there). Every write is the shipper's
 *  dispatch team — the same permission as Load Assignment. */
export function createLoadSourcingRoutes(controller: LoadSourcingController): Router {
  const router = Router();
  const canManageDispatch = requirePermission(DISPATCH_PLANNING_MANAGE);

  // --- Bids (market) and indent acceptance ---
  router.get('/loads/:loadId/bids', validate(v.listBids), asyncHandler(controller.listBids));
  router.post(
    '/loads/:loadId/bids',
    canManageDispatch,
    validate(v.recordBid),
    asyncHandler(controller.recordBid),
  );
  router.patch(
    '/loads/:loadId/bids/:bidId',
    canManageDispatch,
    validate(v.setBidTruck),
    asyncHandler(controller.setBidTruck),
  );
  router.post(
    '/loads/:loadId/bids/:bidId/accept',
    canManageDispatch,
    validate(v.acceptBid),
    asyncHandler(controller.acceptBid),
  );
  router.post(
    '/loads/:loadId/indent/accept',
    canManageDispatch,
    validate(v.recordIndentAcceptance),
    asyncHandler(controller.recordIndentAcceptance),
  );

  // --- Driver and load memo ---
  router.post(
    '/loads/:loadId/driver',
    canManageDispatch,
    validate(v.nameDriver),
    asyncHandler(controller.nameDriver),
  );
  // Govt-portal checks of the load's truck and driver — only failures block.
  router.get(
    '/loads/:loadId/verifications',
    validate(v.getChecks),
    asyncHandler(controller.getChecks),
  );
  router.get('/loads/:loadId/memo', validate(v.getMemo), asyncHandler(controller.getMemo));
  router.post(
    '/loads/:loadId/memo',
    canManageDispatch,
    validate(v.resendMemo),
    asyncHandler(controller.resendMemo),
  );
  router.post(
    '/loads/:loadId/memo/accept',
    canManageDispatch,
    validate(v.acceptMemo),
    asyncHandler(controller.acceptMemo),
  );

  return router;
}
