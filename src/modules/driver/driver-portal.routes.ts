import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
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
// `/me`, `/me/status` (GET), `/me/trip-metrics`, and `/me/loads` are the exception: a driver who
// hasn't linked to any tenant yet still needs these "show me my own stuff" reads to work, so
// they're gated by `driverIdentityAuth` (requireTenant: false — accepts a driver-identity-access
// token, no active relation required) instead of `driverAuth`. Each just returns empty/null when
// there's no tenant — genuinely correct, not a permissions gap, since a driver with no active
// relation cannot be assigned to any load in any tenant. Every *write*/action route (updating
// status, PoD, issues, single-load detail) stays behind the stricter `driverAuth`: acting on a
// specific tenant's data requires an actual tenant-scoped session.
export function createDriverPortalRoutes(
  controller: DriverPortalController,
  driverAuth: RequestHandler,
  driverIdentityAuth: RequestHandler,
): Router {
  const router = Router();

  router.get('/me', driverIdentityAuth, asyncHandler(controller.getMe));
  router.get('/me/status', driverIdentityAuth, asyncHandler(controller.getMyStatus));
  router.get('/me/trip-metrics', driverIdentityAuth, asyncHandler(controller.getMyTripMetrics));
  router.get(
    '/me/loads',
    driverIdentityAuth,
    validate(driverPortalValidators.listMyLoads),
    asyncHandler(controller.getMyLoads),
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

  // Self-service load actions — distinct from /me/status above (that's the driver's own
  // operational status; this is a load's movement status). Ownership (this load must be the
  // caller's own) is enforced in LoadService, not here — see driver-portal.controller.ts.
  router.patch(
    '/loads/:loadId/status',
    validate(driverPortalValidators.updateMyLoadStatus),
    asyncHandler(controller.updateMyLoadStatus),
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
