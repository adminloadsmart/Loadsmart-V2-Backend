import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { createIpRateLimit } from '../../../shared/middleware/rate-limit.middleware';
import { env } from '../../../config/env';
import { DriverPortalController } from './driver-portal.controller';
import { driverPortalValidators } from './driver-portal.validators';

// Mounted at /v1/driver-portal — driver-app self-service only, gated by createDriverAuth (built
// in index.ts, where DriverRepository is already constructed — routes files don't import
// repositories directly, see boundaries/dependencies); driver routers sit in their own
// pre-authMiddleware tier, see app.ts/composition-root.ts. No
// createTenantScope/requireTenant/requirePermission: a driver's tenantId is (almost) always
// present on their own token, and there is no permission matrix to check — self-scoping is the
// whole authorization model. See docs/driver-auth.md.
//
// `/me`, `/me/status` (GET), `/me/trip-metrics`, `/me/loads`, `/me/trips-done`, `/me/home`, and
// every `/me/notifications*` route are the exception: a driver who hasn't linked to any tenant
// yet still needs these "show me my own stuff" reads to work, so they're gated by
// `driverIdentityAuth` (requireTenant: false — accepts a driver-identity-access token, no active
// relation required) instead of `driverAuth`. Each just returns empty/null/zeroed when there's no
// tenant — genuinely correct, not a permissions gap, since a driver with no active relation
// cannot be assigned to any load in any tenant (notifications are never tenant-gated for a driver
// at all — see notification.repository.ts's listByRecipientAcrossTenants). Every *write*/action
// route that acts on a specific tenant's data (updating status, PoD, issues, single-load detail)
// stays behind the stricter `driverAuth`.
export function createDriverPortalRoutes(
  controller: DriverPortalController,
  driverAuth: RequestHandler,
  driverIdentityAuth: RequestHandler,
): Router {
  const router = Router();

  router.get('/me', driverIdentityAuth, asyncHandler(controller.getMe));
  router.get('/me/status', driverIdentityAuth, asyncHandler(controller.getMyStatus));
  // Rate-limited like the other IDfy-backed preflights (verify-dl) — it fans out to a paid check.
  router.post(
    '/me/bank-details/verify',
    createIpRateLimit({
      keyPrefix: 'driver-portal-verify-bank',
      limit: env.driverVerifyDlRateLimitMax,
      windowSeconds: env.driverVerifyDlRateLimitWindowSeconds,
    }),
    driverIdentityAuth,
    validate(driverPortalValidators.verifyMyBankAccount),
    asyncHandler(controller.verifyMyBankAccount),
  );
  router.post(
    '/me/bank-details',
    driverIdentityAuth,
    validate(driverPortalValidators.addMyBankDetails),
    asyncHandler(controller.addMyBankDetails),
  );
  router.get('/me/bank-details', driverIdentityAuth, asyncHandler(controller.listMyBankDetails));
  router.get('/me/trip-metrics', driverIdentityAuth, asyncHandler(controller.getMyTripMetrics));
  router.get(
    '/me/loads',
    driverIdentityAuth,
    validate(driverPortalValidators.listMyLoads),
    asyncHandler(controller.getMyLoads),
  );
  router.get(
    '/me/trips-done',
    driverIdentityAuth,
    validate(driverPortalValidators.getMyTripsDone),
    asyncHandler(controller.getMyTripsDone),
  );
  router.get('/me/home', driverIdentityAuth, asyncHandler(controller.getMyHome));

  router.get(
    '/me/notifications',
    driverIdentityAuth,
    validate(driverPortalValidators.getMyNotifications),
    asyncHandler(controller.getMyNotifications),
  );
  router.patch(
    '/me/notifications/:notificationId/read',
    driverIdentityAuth,
    validate(driverPortalValidators.markMyNotificationRead),
    asyncHandler(controller.markMyNotificationRead),
  );
  // No body/params — marks every one of the caller's own unread notifications read.
  router.post(
    '/me/notifications/mark-all-read',
    driverIdentityAuth,
    asyncHandler(controller.markAllMyNotificationsRead),
  );

  router.use(driverAuth);

  router.patch(
    '/me/status',
    validate(driverPortalValidators.updateMyStatus),
    asyncHandler(controller.updateMyStatus),
  );
  // Single-load detail — distinct from /me/loads above (that's the paginated list). Ownership
  // (this load must be the caller's own) is enforced in LoadService, not here.
  router.get(
    '/loads/:loadId',
    validate(driverPortalValidators.getMyLoad),
    asyncHandler(controller.getMyLoad),
  );
  // Trip Done detail — the "Trips Done" list's per-item drill-down, distinct from the generic
  // single-load detail above (that one carries staff-oriented payments/stepper/nextAction).
  router.get(
    '/loads/:loadId/trip-detail',
    validate(driverPortalValidators.getMyTripDetail),
    asyncHandler(controller.getMyTripDetail),
  );

  // Loading Confirmation — mandatory invoice/e-way-bill/E-LR (skippable per-document once already
  // on the load) plus non-mandatory loading photos/weighing slip. Same ownership-check-as-404
  // convention as the routes below.
  router.patch(
    '/loads/:loadId/confirm-loading',
    validate(driverPortalValidators.confirmMyLoading),
    asyncHandler(controller.confirmMyLoading),
  );
  // "Show papers" — the read counterpart of the PATCH below: E-way bill / LR / Invoice with
  // signed download URLs, for showing at a checkpoint.
  router.get(
    '/loads/:loadId/documents',
    validate(driverPortalValidators.getMyDocuments),
    asyncHandler(controller.getLoadDocuments),
  );
  // Plain document attach/replace, decoupled from confirm-loading's status transition — usable
  // any time before the load is closed, e.g. to correct a document after loading was confirmed.
  router.patch(
    '/loads/:loadId/documents',
    validate(driverPortalValidators.updateMyDocuments),
    asyncHandler(controller.updateMyDocuments),
  );

  // Self-service load actions — distinct from /me/status above (that's the driver's own
  // operational status; this is a load's movement status). Ownership (this load must be the
  // caller's own) is enforced in LoadService, not here — see driver-portal.controller.ts.
  router.patch(
    '/loads/:loadId/status',
    validate(driverPortalValidators.updateMyLoadStatus),
    asyncHandler(controller.updateMyLoadStatus),
  );
  // Optional receiver verification — texts the receiver a 4-digit code that the PATCH below then
  // checks. Skipped entirely when the receiver has no phone.
  router.post(
    '/loads/:loadId/receiver-code',
    createIpRateLimit({
      keyPrefix: 'driver-portal-pod-receiver-code',
      limit: env.podReceiverOtpRequestRateLimitMax,
      windowSeconds: env.podReceiverOtpRequestRateLimitWindowSeconds,
    }),
    validate(driverPortalValidators.sendMyPodReceiverCode),
    asyncHandler(controller.sendMyPodReceiverCode),
  );
  router.patch(
    '/loads/:loadId/pod',
    validate(driverPortalValidators.uploadMyPod),
    asyncHandler(controller.uploadMyPod),
  );
  router.post(
    '/loads/:loadId/issues',
    validate(driverPortalValidators.reportMyIssue),
    asyncHandler(controller.reportMyIssue),
  );

  // Upload handshake for POD and issue-report photos — a driver-portal-scoped mirror of
  // POST /v1/files (unreachable by a driver token; see driver-portal.controller.ts's
  // requestUploadUrl), locked to the 'trips/pod'/'loads/issue' purposes only.
  router.post(
    '/files',
    validate(driverPortalValidators.requestUploadUrl),
    asyncHandler(controller.requestUploadUrl),
  );
  router.post(
    '/files/:fileId/confirm',
    validate(driverPortalValidators.confirmUpload),
    asyncHandler(controller.confirmUpload),
  );

  return router;
}
