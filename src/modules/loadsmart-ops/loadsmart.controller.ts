import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LsSourcingService } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';
import { LsPlacementService } from './ls-placement.service';
import { LsApprovalService } from './ls-approval.service';
import { LsTrackingService } from './ls-tracking.service';
import { LsCsService } from './ls-cs.service';
import { LsReceivablesService } from './ls-receivables.service';
import { LsPayablesService, OriginalPodFilter } from './ls-payables.service';
import { LoadsmartActor, LoadsmartRouteParams, PartnerInput } from './loadsmart.interface';
import { PartnerPaymentStatus, UnclaimedStatus } from './loadsmart.types';

const actorOf = (req: Request): LoadsmartActor => ({ id: req.user!.id, role: req.user!.role });

/** The Loadsmart ops console — platform staff, across every shipper. */
export class LoadsmartOpsController {
  constructor(
    private readonly sourcing: LsSourcingService,
    private readonly settlement: LsSettlementService,
    private readonly placementService: LsPlacementService,
    private readonly approvalService: LsApprovalService,
    private readonly tracking: LsTrackingService,
    private readonly cs: LsCsService,
    private readonly receivables: LsReceivablesService,
    private readonly payables: LsPayablesService,
  ) {}

  // --- Tracking: charges, e-LR, carrier advance ---
  raiseCharge = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.raiseCharge(actorOf(req), req.params.loadId, req.body), 201);
  replyToChargeQuery = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.tracking.replyToChargeQuery(
        req.user!.id,
        req.params.loadId,
        req.params.chargeId!,
        req.body.reply,
      ),
    );
  issueElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.issueElr(actorOf(req), req.params.loadId, req.body), 201);
  editElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.editElr(actorOf(req), req.params.loadId, req.body));
  cancelElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.cancelElr(req.user!.id, req.params.loadId, req.body.note));
  elrRevisions = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.elrRevisions(req.params.loadId));
  raisePartnerAdvance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.raisePartnerAdvance(req.user!.id, req.params.loadId), 201);
  partnerPayments = async (req: Request, res: Response) =>
    respond(
      res,
      await this.tracking.listPartnerPayments(
        ((req.validatedQuery ?? {}) as { status?: PartnerPaymentStatus[] }).status ?? [
          'raised',
          'on_hold',
        ],
      ),
    );
  decidePartnerPayment = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.tracking.decidePartnerPayment(req.user!.id, req.params.paymentId!, req.body),
    );

  // --- Placement ---
  setPartnerClaims = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.placementService.setPartnerClaims(req.user!.id, req.params.partnerId, req.body),
    );
  updatePartnerProfile = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.placementService.updatePartnerProfile(req.user!, req.params.partnerId, req.body),
    );
  matchBrokers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.placementService.matchBrokers(req.params.sourcingId));
  placementInbox = async (req: Request, res: Response) =>
    respond(
      res,
      await this.placementService.inbox(
        req.user!.id,
        (req.validatedQuery ?? {}) as { mine?: boolean; tenantId?: string },
      ),
    );
  getRoster = async (_req: Request, res: Response) =>
    respond(res, await this.placementService.getRoster());
  saveRoster = async (req: Request, res: Response) =>
    respond(res, await this.placementService.saveRoster(req.user!.id, req.body));
  moveOwner = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.placementService.moveOwner(req.user!.id, req.params.sourcingId, req.body.ownerId),
    );
  markLost = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.placementService.markLost(req.user!.id, req.params.sourcingId, req.body),
    );
  withdrawMemo = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.placementService.withdrawMemo(req.user!.id, req.params.loadId, req.body.reason),
    );

  // --- Approval ---
  postForShipper = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.approvalService.postForShipper(
        req.user!,
        req.params.tenantId,
        req.body,
        req.header('Idempotency-Key') ?? undefined,
      ),
      201,
    );

  listPartners = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.listPartners());
  createPartner = async (req: Request, res: Response) =>
    respond(res, await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput), 201);
  updatePartner = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput, req.params.partnerId),
    );

  getTerms = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.getTerms(req.params.tenantId));
  saveTerms = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.saveTerms(req.user!.id, req.params.tenantId, req.body));

  approvalQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.approvalQueue());
  approve = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.approve(req.user!.id, req.params.sourcingId, req.body));
  reject = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.reject(req.user!.id, req.params.sourcingId, req.body.reason));

  loadBoard = async (_req: Request, res: Response) => respond(res, await this.sourcing.loadBoard());
  placementQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.placementQueue());
  placement = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.placement(req.params.sourcingId));
  partnerBid = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.sourcing.recordPartnerBid(actorOf(req), req.params.sourcingId, req.body),
      201,
    );
  sendBid = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.sendBid(req.user!.id, req.params.sourcingId, req.body), 201);

  nameDriver = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.nameDriver(req.user!.id, req.params.loadId, req.body));

  trackingQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.trackingQueue());
  partnerAdvance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.tracking.payPartnerAdvance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  rate = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.settlement.rate(req.user!.id, req.params.loadId, req.body));
  rerunChecks = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.rerunChecks(req.user!.id, req.params.loadId));
  confirmMemo = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.sourcing.confirmMemoOnCall(req.user!.id, req.params.loadId, req.body));
  setUnloadingDetails = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.settlement.setUnloadingDetails(req.user!.id, req.params.loadId, req.body),
    );
  listDocuments = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    const { history } = (req.validatedQuery ?? {}) as { history?: boolean };
    respond(
      res,
      await this.settlement.listDocuments(req.user!, req.params.loadId, Boolean(history)),
    );
  };
  reviewDocument = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.settlement.reviewDocument(
        req.user!,
        req.params.loadId,
        req.params.documentId!,
        req.body,
      ),
    );
  decidePod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.settlement.decidePod(req.user!.id, req.params.loadId, req.body));
  // --- Customer support: claims ---
  claimsInbox = async (req: Request, res: Response) =>
    respond(
      res,
      await this.cs.inbox({
        actorId: req.user!.id,
        mine: Boolean(((req.validatedQuery ?? {}) as { mine?: boolean }).mine),
      }),
    );
  getClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.cs.getClaim(req.params.loadId));
  assignClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.cs.assign(req.user!.id, req.params.loadId, req.body.agentId));
  updateClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.cs.update(actorOf(req), req.params.loadId, req.body));
  closeClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.cs.close(req.user!.id, req.params.loadId, req.body.note));

  // --- Receivables ---
  receivablesInbox = async (_req: Request, res: Response) =>
    respond(res, await this.receivables.inbox());
  invoicePreview = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.receivables.preview(req.params.loadId));
  issueInvoice = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.receivables.issue(actorOf(req), req.params.loadId), 201);
  invoiceDelivery = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.receivables.recordDelivery(req.user!.id, req.params.invoiceId!, req.body),
    );
  listReceipts = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.receivables.listReceipts(req.params.invoiceId!));
  recordReceipt = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.receivables.recordReceipt(req.user!.id, req.params.invoiceId!, req.body),
      201,
    );
  listUnclaimed = async (req: Request, res: Response) =>
    respond(
      res,
      await this.receivables.listUnclaimed(
        ((req.validatedQuery ?? {}) as { status?: UnclaimedStatus[] }).status ?? [
          'unclaimed',
          'under_review',
        ],
      ),
    );
  addUnclaimed = async (req: Request, res: Response) =>
    respond(res, await this.receivables.addUnclaimed(req.user!.id, req.body), 201);
  updateUnclaimed = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.receivables.updateUnclaimed(req.user!.id, req.params.paymentId!, req.body),
    );
  matchUnclaimed = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.receivables.matchUnclaimed(req.user!.id, req.params.paymentId!, req.body),
      201,
    );

  // --- Payables: original POD and the carrier balance ---
  originalPods = async (req: Request, res: Response) =>
    respond(
      res,
      await this.payables.listOriginalPods((req.validatedQuery ?? {}) as OriginalPodFilter),
    );
  updateOriginalPod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.payables.updateOriginalPod(req.user!.id, req.params.loadId, req.body));
  logOriginalPodCall = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.payables.logCall(req.user!.id, req.params.loadId, req.body), 201);
  balancePreview = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.payables.balancePreview(req.params.loadId));
  raiseBalance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.payables.raiseBalance(req.user!.id, req.params.loadId), 201);
  partnerBalance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.payables.payBalance(req.user!.id, req.params.loadId, req.body));

  /** Everything Loadsmart holds on one load. */
  loadDetail = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.settlement.loadDetail(req.params.loadId));
}

/** The shipper's side of a Loadsmart load, on /v1/loads. */
export class LoadsmartShipperController {
  constructor(private readonly service: LsShipperService) {}

  listCharges = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.service.listCharges(requireTenantId(req), req.params.loadId));
  decideCharge = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.decideCharge(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.params.chargeId,
        req.body,
      ),
    );
  addCharge = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.addCharge(requireTenantId(req), req.user!.id, req.params.loadId, req.body),
      201,
    );
  getClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.service.getClaim(requireTenantId(req), req.params.loadId));
  claimValue = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.addClaimValue(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
    );
  invoice = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.getInvoice(requireTenantId(req), req.user!.role, req.params.loadId),
    );
  documentsBundle = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.documentsBundle(requireTenantId(req), req.user!.role, req.params.loadId),
    );
}
