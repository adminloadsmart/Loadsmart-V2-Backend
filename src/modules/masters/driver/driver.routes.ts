import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { createIpRateLimit } from '../../../shared/middleware/rate-limit.middleware';
import { env } from '../../../config/env';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { DriverController } from './driver.controller';
import { driverValidators } from './driver.validators';

export function createDriverRoutes(controller: DriverController): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);
  // Approve/reject a pending driver — org_admin only (see db/seed-roles.ts).
  const canApprove = requirePermission(MASTERS_APPROVE);
  // Throttles POST /drivers/verify-dl — it fans out to IDfy's paid Sarathi lookup. Same
  // createIpRateLimit + env-driven limit/window pattern as auth.routes.ts.
  const verifyDriverDlRateLimit = createIpRateLimit({
    keyPrefix: 'verify-dl',
    limit: env.driverVerifyDlRateLimitMax,
    windowSeconds: env.driverVerifyDlRateLimitWindowSeconds,
  });

  // Step-2 preflight for "Add a driver" — checks a licence before the driver exists, so it has no
  // :driverId param. Declared before '/drivers/onboard' for the same reason as vehicles/onboard.
  router.post(
    '/drivers/verify-dl',
    verifyDriverDlRateLimit,
    canWrite,
    validate(driverValidators.verifyDriverDl),
    asyncHandler(controller.verifyDriverDl),
  );

  // Backs the single "Save driver" button — whole form, one transaction.
  router.post(
    '/drivers/onboard',
    canWrite,
    validate(driverValidators.onboardDriver),
    asyncHandler(controller.onboardDriver),
  );
  router.get(
    '/drivers',
    validate(driverValidators.listDrivers),
    asyncHandler(controller.listDrivers),
  );
  router.get(
    '/drivers/:driverId',
    validate(driverValidators.getDriver),
    asyncHandler(controller.getDriver),
  );
  router.patch(
    '/drivers/:driverId',
    canWrite,
    validate(driverValidators.updateDriver),
    asyncHandler(controller.updateDriver),
  );
  router.delete(
    '/drivers/:driverId',
    canWrite,
    validate(driverValidators.deleteDriver),
    asyncHandler(controller.deleteDriver),
  );

  // Settings → Approvals. Only a `pending` driver (added by dispatch) can be approved/rejected —
  // org_admin's own onboardDriver calls land `active` immediately and never need this.
  router.patch(
    '/drivers/:driverId/approve',
    canApprove,
    validate(driverValidators.approveDriver),
    asyncHandler(controller.approveDriver),
  );
  router.patch(
    '/drivers/:driverId/reject',
    canApprove,
    validate(driverValidators.rejectDriver),
    asyncHandler(controller.rejectDriver),
  );

  router.post(
    '/drivers/:driverId/documents',
    canWrite,
    validate(driverValidators.addDriverDocument),
    asyncHandler(controller.addDriverDocument),
  );
  router.get(
    '/drivers/:driverId/documents',
    validate(driverValidators.listDriverDocuments),
    asyncHandler(controller.listDriverDocuments),
  );
  router.delete(
    '/drivers/:driverId/documents/:documentId',
    canWrite,
    validate(driverValidators.deleteDriverDocument),
    asyncHandler(controller.deleteDriverDocument),
  );

  router.post(
    '/drivers/:driverId/verifications',
    canWrite,
    validate(driverValidators.recordDriverVerification),
    asyncHandler(controller.recordDriverVerification),
  );
  router.get(
    '/drivers/:driverId/verifications',
    validate(driverValidators.listDriverVerifications),
    asyncHandler(controller.listDriverVerifications),
  );

  router.post(
    '/drivers/:driverId/bank-details',
    canWrite,
    validate(driverValidators.addDriverBankDetails),
    asyncHandler(controller.addDriverBankDetails),
  );
  router.get(
    '/drivers/:driverId/bank-details',
    validate(driverValidators.listDriverBankDetails),
    asyncHandler(controller.listDriverBankDetails),
  );
  router.patch(
    '/drivers/:driverId/bank-details/:bankDetailsId/verification',
    canWrite,
    validate(driverValidators.setDriverBankDetailsVerification),
    asyncHandler(controller.setDriverBankDetailsVerification),
  );
  router.delete(
    '/drivers/:driverId/bank-details/:bankDetailsId',
    canWrite,
    validate(driverValidators.deleteDriverBankDetails),
    asyncHandler(controller.deleteDriverBankDetails),
  );

  router.get(
    '/drivers/:driverId/operational-status',
    validate(driverValidators.getDriverOperationalStatus),
    asyncHandler(controller.getDriverOperationalStatus),
  );
  // "My Drivers" status dropdown (On trip / Active / On leave); one row per driver, so the first
  // call inserts and later calls overwrite it.
  router.patch(
    '/drivers/:driverId/status',
    canWrite,
    validate(driverValidators.setDriverOperationalStatus),
    asyncHandler(controller.setDriverOperationalStatus),
  );

  router.put(
    '/drivers/:driverId/trip-metrics',
    canWrite,
    validate(driverValidators.recordDriverTripMetrics),
    asyncHandler(controller.recordDriverTripMetrics),
  );
  router.get(
    '/drivers/:driverId/trip-metrics',
    validate(driverValidators.listDriverTripMetrics),
    asyncHandler(controller.listDriverTripMetrics),
  );

  return router;
}
