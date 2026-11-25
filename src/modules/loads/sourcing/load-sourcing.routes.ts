import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import {
  DISPATCH_PLANNING_MANAGE,
  TRUCK_VERIFY_MANUAL,
  DRIVER_VERIFY_MANUAL,
} from '../../../shared/constants/permissions';
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
  router.post(
    '/loads/:loadId/bid-window/extend',
    canManageDispatch,
    validate(v.extendBidWindow),
    asyncHandler(controller.extendBidWindow),
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
    '/loads/:loadId/bids/:bidId/counter',
    canManageDispatch,
    validate(v.counterBid),
    asyncHandler(controller.counterBid),
  );
  router.post(
    '/loads/:loadId/bids/:bidId/counter-response',
    canManageDispatch,
    validate(v.answerCounter),
    asyncHandler(controller.answerCounter),
  );
  router.post(
    '/loads/:loadId/bids/:bidId/reject',
    canManageDispatch,
    validate(v.rejectBid),
    asyncHandler(controller.rejectBid),
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
  router.post(
    '/loads/:loadId/indent/reject',
    canManageDispatch,
    validate(v.recordIndentRejection),
    asyncHandler(controller.recordIndentRejection),
  );
  // Govt-portal checks of the load's truck and driver — the memo needs both passed.
  router.get(
    '/loads/:loadId/verifications',
    validate(v.getChecks),
    asyncHandler(controller.getChecks),
  );
  router.post(
    '/loads/:loadId/verifications/rerun',
    canManageDispatch,
    validate(v.rerunChecks),
    asyncHandler(controller.rerunChecks),
  );
  // VAHAN couldn't be reached for the truck — an org admin verifies it by hand.
  router.post(
    '/loads/:loadId/verifications/truck/manual',
    requirePermission(TRUCK_VERIFY_MANUAL),
    validate(v.verifyTruckManually),
    asyncHandler(controller.verifyTruckManually),
  );
  // Sarathi couldn't confirm the driver's licence — an org admin verifies it by hand.
  router.post(
    '/loads/:loadId/verifications/driver/manual',
    requirePermission(DRIVER_VERIFY_MANUAL),
    validate(v.verifyDriverManually),
    asyncHandler(controller.verifyDriverManually),
  );
  router.get('/loads/:loadId/memo', validate(v.getMemo), asyncHandler(controller.getMemo));
  router.get('/loads/:loadId/memos', validate(v.listMemos), asyncHandler(controller.listMemos));
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

  // --- Truck cancelled before loading ---
  router.post(
    '/loads/:loadId/truck-cancellation',
    canManageDispatch,
    validate(v.cancelTruck),
    asyncHandler(controller.cancelTruck),
  );
  // --- Withdraw the load, until the load memo is accepted ---
  router.post(
    '/loads/:loadId/withdraw',
    canManageDispatch,
    validate(v.withdrawLoad),
    asyncHandler(controller.withdrawLoad),
  );
  // --- Cancel the load, before Loaded (a Loadsmart load waits for Super Admin) ---
  router.get(
    '/loads/:loadId/cancellation',
    validate(v.listTruckCancellations),
    asyncHandler(controller.cancellationOptions),
  );
  router.post(
    '/loads/:loadId/cancel',
    canManageDispatch,
    validate(v.cancelLoad),
    asyncHandler(controller.cancelLoad),
  );
  router.get(
    '/loads/:loadId/truck-cancellations',
    validate(v.listTruckCancellations),
    asyncHandler(controller.listTruckCancellations),
  );

  return router;
}
