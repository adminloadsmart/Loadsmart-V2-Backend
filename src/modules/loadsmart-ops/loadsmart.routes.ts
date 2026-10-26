import { RequestHandler, Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import {
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  LS_APPROVAL,
  LS_CS,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_POD,
  LS_RECEIVABLES,
  LS_TRACKING,
  LS_VERIFICATION,
} from '../../shared/constants/permissions';
import { LoadsmartOpsController, LoadsmartShipperController } from './loadsmart.controller';
import { loadsmartValidators as v } from './loadsmart.validators';

const ANY_TEAM = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_VERIFICATION,
  LS_TRACKING,
  LS_POD,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
];

/** /v1/loadsmart-ops — the ops console. Each team's routes are gated by its own permission
 *  (platform_admin passes every gate). */
export function createLoadsmartOpsRoutes(c: LoadsmartOpsController): Router {
  const router = Router();
  const team = (...keys: string[]): RequestHandler => requirePermission(...keys);
  const anyTeam = team(...ANY_TEAM);

  // Partners and each shipper's commercial terms.
  router.get('/partners', anyTeam, asyncHandler(c.listPartners));
  router.post(
    '/partners',
    team(LS_PLACEMENT),
    validate(v.createPartner),
    asyncHandler(c.createPartner),
  );
  router.patch(
    '/partners/:partnerId',
    team(LS_PLACEMENT),
    validate(v.updatePartner),
    asyncHandler(c.updatePartner),
  );
  router.get('/terms/:tenantId', anyTeam, validate(v.getTerms), asyncHandler(c.getTerms));
  router.put(
    '/terms/:tenantId',
    team(LS_APPROVAL),
    validate(v.saveTerms),
    asyncHandler(c.saveTerms),
  );

  // Part 1 — posting to loaded.
  router.get('/approval-queue', team(LS_APPROVAL), asyncHandler(c.approvalQueue));
  router.post(
    '/sourcings/:sourcingId/approve',
    team(LS_APPROVAL),
    validate(v.approve),
    asyncHandler(c.approve),
  );
  router.post(
    '/sourcings/:sourcingId/reject',
    team(LS_APPROVAL),
    validate(v.reject),
    asyncHandler(c.reject),
  );
  router.get('/load-board', team(LS_PLACEMENT), asyncHandler(c.loadBoard));
  router.get('/placement-queue', team(LS_PLACEMENT), asyncHandler(c.placementQueue));
  router.get(
    '/sourcings/:sourcingId/placement',
    team(LS_PLACEMENT),
    validate(v.sourcing),
    asyncHandler(c.placement),
  );
  router.post(
    '/sourcings/:sourcingId/partner-bids',
    team(LS_PLACEMENT),
    validate(v.partnerBid),
    asyncHandler(c.partnerBid),
  );
  router.post(
    '/sourcings/:sourcingId/send-bid',
    team(LS_PLACEMENT),
    validate(v.sendBid),
    asyncHandler(c.sendBid),
  );
  router.post(
    '/loads/:loadId/driver',
    team(LS_PLACEMENT),
    validate(v.nameDriver),
    asyncHandler(c.nameDriver),
  );
  router.get('/verification-queue', team(LS_VERIFICATION), asyncHandler(c.verificationQueue));
  router.post(
    '/loads/:loadId/verification/approve',
    team(LS_VERIFICATION),
    validate(v.approveVerification),
    asyncHandler(c.approveVerification),
  );
  router.get('/tracking-queue', team(LS_TRACKING), asyncHandler(c.trackingQueue));
  router.patch(
    '/loads/:loadId/status',
    team(LS_TRACKING),
    validate(v.markStage),
    asyncHandler(c.markStage),
  );
  router.patch(
    '/loads/:loadId/documents',
    team(LS_TRACKING),
    validate(v.uploadPapers),
    asyncHandler(c.uploadPapers),
  );
  router.post(
    '/loads/:loadId/papers/approve',
    team(LS_TRACKING),
    validate(v.approvePapers),
    asyncHandler(c.approvePapers),
  );
  router.post(
    '/loads/:loadId/charges',
    team(LS_TRACKING),
    validate(v.raiseCharge),
    asyncHandler(c.raiseCharge),
  );
  router.post(
    '/loads/:loadId/partner-advance',
    team(LS_PAYABLES),
    validate(v.partnerPayment),
    asyncHandler(c.partnerAdvance),
  );

  // Part 2 — drop to payment.
  router.patch(
    '/loads/:loadId/pod/review',
    team(LS_TRACKING),
    validate(v.reviewPod),
    asyncHandler(c.reviewPod),
  );
  router.get('/cs-queue', team(LS_CS), asyncHandler(c.csQueue));
  router.post(
    '/loads/:loadId/claim/settle',
    team(LS_CS),
    validate(v.settleClaim),
    asyncHandler(c.settleClaim),
  );
  router.get('/pod-queue', team(LS_POD), asyncHandler(c.podQueue));
  router.post('/loads/:loadId/ratings', team(LS_POD), validate(v.rate), asyncHandler(c.rate));
  router.post(
    '/loads/:loadId/original-pod',
    team(LS_POD),
    validate(v.originalPod),
    asyncHandler(c.originalPod),
  );
  router.get('/receivables-queue', team(LS_RECEIVABLES), asyncHandler(c.receivablesQueue));
  router.post(
    '/loads/:loadId/invoice',
    team(LS_RECEIVABLES),
    validate(v.invoice),
    asyncHandler(c.invoice),
  );
  router.post(
    '/loads/:loadId/payments/:paymentId/decision',
    team(LS_RECEIVABLES),
    validate(v.decidePayment),
    asyncHandler(c.decidePayment),
  );
  router.post(
    '/loads/:loadId/partner-balance',
    team(LS_PAYABLES),
    validate(v.partnerPayment),
    asyncHandler(c.partnerBalance),
  );

  router.get('/loads/:loadId', anyTeam, validate(v.load), asyncHandler(c.loadDetail));
  return router;
}

/** The shipper's Loadsmart routes, mounted on the tenant loads router (/v1/loads). */
export function createLoadsmartShipperRoutes(c: LoadsmartShipperController): Router {
  const router = Router();
  router.use(requireTenant);
  const canDispatch = requirePermission(DISPATCH_PLANNING_MANAGE);
  const canDocuments = requirePermission(LOADS_DOCUMENTS_MANAGE);

  router.get('/loads/:loadId/charges', validate(v.load), asyncHandler(c.listCharges));
  router.post(
    '/loads/:loadId/charges/:chargeId/decision',
    canDispatch,
    validate(v.decideCharge),
    asyncHandler(c.decideCharge),
  );
  router.post(
    '/loads/:loadId/charges/unloading',
    canDocuments,
    validate(v.unloadingCharge),
    asyncHandler(c.unloadingCharge),
  );
  router.patch(
    '/loads/:loadId/unloading-contact',
    canDispatch,
    validate(v.unloadingContact),
    asyncHandler(c.unloadingContact),
  );
  router.get('/loads/:loadId/claim', validate(v.load), asyncHandler(c.getClaim));
  router.post(
    '/loads/:loadId/claim',
    canDispatch,
    validate(v.claimValue),
    asyncHandler(c.claimValue),
  );
  router.get('/loads/:loadId/invoice', validate(v.load), asyncHandler(c.invoice));
  router.get('/loads/:loadId/documents-bundle', validate(v.load), asyncHandler(c.documentsBundle));
  return router;
}
