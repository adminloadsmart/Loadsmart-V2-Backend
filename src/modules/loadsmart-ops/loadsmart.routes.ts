import { RequestHandler, Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import {
  DISPATCH_PLANNING_MANAGE,
  LS_APPROVAL,
  LS_CS,
  LS_MONEY_APPROVE,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_RECEIVABLES,
  LS_SETTINGS_MANAGE,
  LS_TRACKING,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { LoadsmartOpsController, LoadsmartShipperController } from './loadsmart.controller';
import { loadsmartValidators as v } from './loadsmart.validators';

const ANY_TEAM = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_TRACKING,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
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

  // Brokers — Approval records what each claims; Placement sees who matches a load.
  router.put(
    '/partners/:partnerId/claims',
    team(LS_APPROVAL),
    validate(v.partnerClaims),
    asyncHandler(c.setPartnerClaims),
  );
  router.patch(
    '/partners/:partnerId/profile',
    team(LS_APPROVAL),
    validate(v.partnerProfile),
    asyncHandler(c.updatePartnerProfile),
  );
  router.get(
    '/sourcings/:sourcingId/brokers',
    team(LS_PLACEMENT),
    validate(v.matchBrokers),
    asyncHandler(c.matchBrokers),
  );

  // Placement — inbox, round-robin roster (Super Admin), owner, lost, memo withdrawal.
  router.get(
    '/placement/inbox',
    team(LS_PLACEMENT, LS_SETTINGS_MANAGE),
    validate(v.placementInbox),
    asyncHandler(c.placementInbox),
  );
  router.get(
    '/placement/roster',
    team(LS_SETTINGS_MANAGE, LS_PLACEMENT),
    asyncHandler(c.getRoster),
  );
  router.put(
    '/placement/roster',
    team(LS_SETTINGS_MANAGE),
    validate(v.saveRoster),
    asyncHandler(c.saveRoster),
  );
  router.patch(
    '/sourcings/:sourcingId/owner',
    team(LS_SETTINGS_MANAGE),
    validate(v.moveOwner),
    asyncHandler(c.moveOwner),
  );
  router.post(
    '/sourcings/:sourcingId/lost',
    team(LS_PLACEMENT),
    validate(v.markLost),
    asyncHandler(c.markLost),
  );
  router.post(
    '/loads/:loadId/memo/withdraw',
    team(LS_PLACEMENT),
    validate(v.withdrawMemo),
    asyncHandler(c.withdrawMemo),
  );

  // Approval — post a load on a shipper's behalf.
  router.post(
    '/shippers/:tenantId/loads',
    team(LS_APPROVAL),
    validate(v.postForShipper),
    asyncHandler(c.postForShipper),
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
  // The shipper countered Loadsmart's bid — Placement answers.
  router.post(
    '/loads/:loadId/bids/:bidId/counter-response',
    team(LS_PLACEMENT),
    validate(v.answerShipperCounter),
    asyncHandler(c.answerShipperCounter),
  );
  router.post(
    '/loads/:loadId/driver',
    team(LS_PLACEMENT),
    validate(v.nameDriver),
    asyncHandler(c.nameDriver),
  );
  router.post(
    '/loads/:loadId/verifications/rerun',
    team(LS_PLACEMENT),
    validate(v.rerunChecks),
    asyncHandler(c.rerunChecks),
  );
  router.post(
    '/loads/:loadId/memo/confirm',
    team(LS_PLACEMENT),
    validate(v.confirmMemo),
    asyncHandler(c.confirmMemo),
  );
  router.get('/tracking-queue', team(LS_TRACKING), asyncHandler(c.trackingQueue));
  router.put(
    '/loads/:loadId/unloading-details',
    team(LS_TRACKING),
    validate(v.unloadingDetails),
    asyncHandler(c.setUnloadingDetails),
  );
  router.get(
    '/loads/:loadId/documents',
    anyTeam,
    validate(v.listDocuments),
    asyncHandler(c.listDocuments),
  );
  router.post(
    '/loads/:loadId/documents/:documentId/review',
    team(LS_TRACKING),
    validate(v.reviewDocument),
    asyncHandler(c.reviewDocument),
  );
  router.post(
    '/loads/:loadId/pod/decision',
    team(LS_TRACKING),
    validate(v.decidePod),
    asyncHandler(c.decidePod),
  );
  // Tracking — charges with proof, the e-LR, the carrier advance.
  router.post(
    '/loads/:loadId/ls-charges',
    team(LS_TRACKING),
    validate(v.raiseCharge),
    asyncHandler(c.raiseCharge),
  );
  router.post(
    '/loads/:loadId/ls-charges/:chargeId/reply',
    team(LS_TRACKING),
    validate(v.replyToChargeQuery),
    asyncHandler(c.replyToChargeQuery),
  );
  router.post(
    '/loads/:loadId/elr',
    team(LS_TRACKING),
    validate(v.issueElr),
    asyncHandler(c.issueElr),
  );
  router.patch(
    '/loads/:loadId/elr',
    team(LS_TRACKING),
    validate(v.editElr),
    asyncHandler(c.editElr),
  );
  router.post(
    '/loads/:loadId/elr/cancel',
    team(LS_TRACKING),
    validate(v.cancelElr),
    asyncHandler(c.cancelElr),
  );
  router.get(
    '/loads/:loadId/elr/revisions',
    anyTeam,
    validate(v.load),
    asyncHandler(c.elrRevisions),
  );
  router.post(
    '/loads/:loadId/partner-advance/raise',
    team(LS_TRACKING),
    validate(v.load),
    asyncHandler(c.raisePartnerAdvance),
  );
  // Super Admin approves money going out; Payables sees what is approved to pay.
  router.get(
    '/partner-payments',
    team(LS_MONEY_APPROVE, LS_PAYABLES),
    validate(v.partnerPayments),
    asyncHandler(c.partnerPayments),
  );
  router.post(
    '/partner-payments/:paymentId/decision',
    team(LS_MONEY_APPROVE),
    validate(v.decidePartnerPayment),
    asyncHandler(c.decidePartnerPayment),
  );
  router.post(
    '/loads/:loadId/partner-advance',
    team(LS_PAYABLES),
    validate(v.partnerPayment),
    asyncHandler(c.partnerAdvance),
  );

  // Customer support — claims on loads delivered with issues; Tracking assigns the agent.
  router.get(
    '/claims',
    team(LS_CS, LS_TRACKING),
    validate(v.claimsInbox),
    asyncHandler(c.claimsInbox),
  );
  router.get(
    '/loads/:loadId/claim',
    team(LS_CS, LS_TRACKING),
    validate(v.load),
    asyncHandler(c.getClaim),
  );
  router.post(
    '/loads/:loadId/claim/assign',
    team(LS_TRACKING),
    validate(v.assignClaim),
    asyncHandler(c.assignClaim),
  );
  router.patch(
    '/loads/:loadId/claim',
    team(LS_CS),
    validate(v.updateClaim),
    asyncHandler(c.updateClaim),
  );
  router.post(
    '/loads/:loadId/claim/close',
    team(LS_CS),
    validate(v.closeClaim),
    asyncHandler(c.closeClaim),
  );

  // Ratings (Payables, once delivered).
  router.post('/loads/:loadId/ratings', team(LS_PAYABLES), validate(v.rate), asyncHandler(c.rate));

  // Receivables — inbox, invoice builder, receipts, unclaimed payments.
  router.get('/receivables/inbox', team(LS_RECEIVABLES), asyncHandler(c.receivablesInbox));
  router.get(
    '/loads/:loadId/invoice/preview',
    team(LS_RECEIVABLES),
    validate(v.load),
    asyncHandler(c.invoicePreview),
  );
  router.post(
    '/loads/:loadId/invoice',
    team(LS_RECEIVABLES),
    validate(v.load),
    asyncHandler(c.issueInvoice),
  );
  router.patch(
    '/invoices/:invoiceId/delivery',
    team(LS_RECEIVABLES),
    validate(v.invoiceDelivery),
    asyncHandler(c.invoiceDelivery),
  );
  router.get(
    '/invoices/:invoiceId/receipts',
    team(LS_RECEIVABLES),
    validate(v.invoice),
    asyncHandler(c.listReceipts),
  );
  router.post(
    '/invoices/:invoiceId/receipts',
    team(LS_RECEIVABLES),
    validate(v.recordReceipt),
    asyncHandler(c.recordReceipt),
  );
  router.get(
    '/unclaimed-payments',
    team(LS_RECEIVABLES),
    validate(v.listUnclaimed),
    asyncHandler(c.listUnclaimed),
  );
  router.post(
    '/unclaimed-payments',
    team(LS_RECEIVABLES),
    validate(v.addUnclaimed),
    asyncHandler(c.addUnclaimed),
  );
  router.patch(
    '/unclaimed-payments/:paymentId',
    team(LS_RECEIVABLES),
    validate(v.updateUnclaimed),
    asyncHandler(c.updateUnclaimed),
  );
  router.post(
    '/unclaimed-payments/:paymentId/match',
    team(LS_RECEIVABLES),
    validate(v.matchUnclaimed),
    asyncHandler(c.matchUnclaimed),
  );

  // Payables — original POD tracker, carrier balance (raised here, approved by Super Admin on
  // /partner-payments/:id/decision, paid here).
  router.get(
    '/original-pods',
    team(LS_PAYABLES),
    validate(v.originalPods),
    asyncHandler(c.originalPods),
  );
  router.patch(
    '/loads/:loadId/original-pod',
    team(LS_PAYABLES),
    validate(v.updateOriginalPod),
    asyncHandler(c.updateOriginalPod),
  );
  router.post(
    '/loads/:loadId/original-pod/calls',
    team(LS_PAYABLES),
    validate(v.originalPodCall),
    asyncHandler(c.logOriginalPodCall),
  );
  router.get(
    '/loads/:loadId/partner-balance',
    team(LS_PAYABLES, LS_MONEY_APPROVE),
    validate(v.load),
    asyncHandler(c.balancePreview),
  );
  router.post(
    '/loads/:loadId/partner-balance/raise',
    team(LS_PAYABLES),
    validate(v.load),
    asyncHandler(c.raiseBalance),
  );
  router.post(
    '/loads/:loadId/partner-balance',
    team(LS_PAYABLES),
    validate(v.partnerPayment),
    asyncHandler(c.partnerBalance),
  );

  // Cross-team views. Every team reads All loads (money as it may see it); Super Admin has the
  // approvals queue and analytics; Tracking and Super Admin the live map.
  router.get('/all-loads', anyTeam, validate(v.allLoads), asyncHandler(c.allLoads));
  router.get('/all-loads/:loadId', anyTeam, validate(v.load), asyncHandler(c.loadPanel));
  router.get('/approvals', team(LS_MONEY_APPROVE), asyncHandler(c.approvals));
  // A shipper's cancellation of a load Loadsmart has won waits for Super Admin.
  router.get(
    '/cancellation-requests',
    team(LS_MONEY_APPROVE, LS_SETTINGS_MANAGE),
    asyncHandler(c.cancellationRequests),
  );
  router.post(
    '/cancellation-requests/:cancellationId/decision',
    team(LS_MONEY_APPROVE, LS_SETTINGS_MANAGE),
    validate(v.decideCancellation),
    asyncHandler(c.decideCancellation),
  );
  router.get(
    '/analytics',
    team(LS_MONEY_APPROVE, LS_SETTINGS_MANAGE),
    validate(v.analytics),
    asyncHandler(c.analytics),
  );
  router.get(
    '/live-map',
    team(LS_TRACKING, LS_MONEY_APPROVE, LS_SETTINGS_MANAGE),
    validate(v.liveMap),
    asyncHandler(c.liveMap),
  );

  router.get('/loads/:loadId', anyTeam, validate(v.load), asyncHandler(c.loadDetail));
  return router;
}

/** The shipper's Loadsmart routes, mounted on the tenant loads router (/v1/loads). */
export function createLoadsmartShipperRoutes(c: LoadsmartShipperController): Router {
  const router = Router();
  router.use(requireTenant);
  const canDispatch = requirePermission(DISPATCH_PLANNING_MANAGE);
  const canPayments = requirePermission(PAYMENTS_MANAGE);
  // Charges and claims are money, but dispatch decides them — so either key reads them.
  const canSeeChargesAndClaims = requirePermission(PAYMENTS_MANAGE, DISPATCH_PLANNING_MANAGE);

  router.get(
    '/loads/:loadId/charges',
    canSeeChargesAndClaims,
    validate(v.load),
    asyncHandler(c.listCharges),
  );
  router.post(
    '/loads/:loadId/charges/decisions',
    canDispatch,
    validate(v.decideCharges),
    asyncHandler(c.decideCharges),
  );
  router.post(
    '/loads/:loadId/charges/:chargeId/decision',
    canDispatch,
    validate(v.decideCharge),
    asyncHandler(c.decideCharge),
  );
  router.post(
    '/loads/:loadId/charges',
    canDispatch,
    validate(v.addCharge),
    asyncHandler(c.addCharge),
  );
  router.get(
    '/loads/:loadId/claim',
    canSeeChargesAndClaims,
    validate(v.load),
    asyncHandler(c.getClaim),
  );
  router.post(
    '/loads/:loadId/claim',
    canDispatch,
    validate(v.claimValue),
    asyncHandler(c.claimValue),
  );
  router.get('/loads/:loadId/invoice', canPayments, validate(v.load), asyncHandler(c.invoice));
  router.get('/loads/:loadId/documents-bundle', validate(v.load), asyncHandler(c.documentsBundle));
  return router;
}
