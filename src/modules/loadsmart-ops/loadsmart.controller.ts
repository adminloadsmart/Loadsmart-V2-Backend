import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { hasPermission } from '../../shared/middleware/require-permission.middleware';
import { LS_MARGIN_MANAGE, LS_MARGIN_VIEW } from '../../shared/constants/permissions';
import { AuthorizationError } from '../../shared/errors';
import { redactMargin } from './redact-margin';
import { redactMoney } from './redact-money';
import { moneyVisibility } from './console-rules';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LsSourcingService } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';
import { LsPlacementService } from './ls-placement.service';
import { LsShipperDirectoryService } from './ls-shipper-directory.service';
import { LsApprovalService } from './ls-approval.service';
import { LsTrackingService } from './ls-tracking.service';
import { LsCsService } from './ls-cs.service';
import { LsPlacementBoardService, PlacementBoardQuery } from './ls-placement-board.service';
import { LsReceivablesService, ReceivablesBoardQuery } from './ls-receivables.service';
import type { GstTreatment } from './receivables-rules';
import { LsPayablesService, OriginalPodFilter } from './ls-payables.service';
import { AllLoadsQuery, LsConsoleService } from './ls-console.service';
import { LsStaffNotifier } from './ls-staff-notifier';
import { LsCallLogService } from './ls-call-log.service';
import type { LiveStatus } from './console-rules';
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
    private readonly consoleViews: LsConsoleService,
    private readonly staffNotifier: LsStaffNotifier,
    private readonly callLogs: LsCallLogService,
    private readonly placementBoard: LsPlacementBoardService,
    private readonly shipperDirectory: LsShipperDirectoryService,
  ) {}

  // --- Placement work queue and load page ---
  placementBoardList = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.board(
        req.user!.id,
        (req.validatedQuery ?? {}) as PlacementBoardQuery,
      ),
    );
  placementPage = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.placementBoard.page(req.params.sourcingId));
  addBroker = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.addBroker(req.user!.id, req.params.sourcingId, req.body),
      201,
    );
  addBrokers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.addBrokers(req.user!.id, req.params.sourcingId, req.body.brokerIds),
      201,
    );
  removeBroker = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    await this.placementBoard.removeBroker(
      req.user!.id,
      req.params.sourcingId,
      req.params.partnerId,
    );
    res.status(204).end();
  };
  bidHistory = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.bidHistory(req.params.sourcingId, req.params.partnerId),
    );
  logBrokerCall = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.logBrokerCall(req.user!.id, req.params.sourcingId, req.body),
      201,
    );
  brokerCalls = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.placementBoard.brokerCalls(req.params.sourcingId));
  extendBidWindow = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.extendBidWindow(
        req.user!.id,
        req.params.sourcingId,
        req.body.hours,
        req.body.reason,
      ),
    );
  sendRequirement = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementBoard.sendRequirement(
        req.user!.id,
        req.params.sourcingId,
        (req.body as { partnerIds?: string[] } | undefined)?.partnerIds,
      ),
    );

  // --- Tracking: papers, POD, documents page ---
  uploadPapers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.settlement.uploadPapers(actorOf(req), req.params.loadId, req.body));
  uploadPod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.settlement.uploadPod(actorOf(req), req.params.loadId, req.body));
  documentsPage = async (req: Request, res: Response) =>
    respond(
      res,
      await this.settlement.documentsPage(
        actorOf(req),
        (req.validatedQuery ?? {}) as Parameters<LsSettlementService['documentsPage']>[1],
      ),
    );

  // --- Tracking's call log ---
  logCall = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.callLogs.logCall(req.user!.id, req.params.loadId, req.body), 201);
  listCalls = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.callLogs.listCalls(
        req.params.loadId,
        ((req.validatedQuery ?? {}) as { limit?: number }).limit,
      ),
    );

  // --- The member's own in-app inbox ---
  notifications = async (req: Request, res: Response) => {
    const query = (req.validatedQuery ?? {}) as { unreadOnly?: boolean; limit?: number };
    respond(res, await this.staffNotifier.list(req.user!.id, query));
  };
  readNotification = async (req: Request<{ notificationId: string }>, res: Response) => {
    await this.staffNotifier.markRead(req.user!.id, req.params.notificationId);
    respond(res, { read: true });
  };
  readAllNotifications = async (req: Request, res: Response) =>
    respond(res, { read: await this.staffNotifier.markAllRead(req.user!.id) });

  /** Every ops response goes through here: margin is stripped unless the caller may see it
   *  (LS_MARGIN_VIEW — Placement and the Admin team; platform_admin via its bypass). */
  private out(req: Request, res: Response, data: unknown, statusCode = 200): void {
    respond(res, hasPermission(req.user!, LS_MARGIN_VIEW) ? data : redactMargin(data), statusCode);
  }

  /** Margin is an Admin setting (notes §4 Settings): Approval saves a shipper's terms and approves
   *  loads, but only the Admin team (LS_MARGIN_MANAGE; platform_admin via its bypass) may send a
   *  marginPercent on either. */
  private assertMayChangeMargin(req: Request): void {
    if (req.body?.marginPercent !== undefined && !hasPermission(req.user!, LS_MARGIN_MANAGE)) {
      throw new AuthorizationError('Only the Admin team can change the margin');
    }
  }

  // --- Cross-team views: All loads (L01), approvals (S01), analytics (S02), live map (T07) ---
  allLoads = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.consoleViews.allLoads(req.user!, (req.validatedQuery ?? {}) as AllLoadsQuery),
    );
  trackingInbox = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.consoleViews.trackingInbox(
        { id: req.user!.id, role: req.user!.role, permissions: req.user!.permissions },
        (req.validatedQuery ?? {}) as Parameters<LsConsoleService['trackingInbox']>[1],
      ),
    );
  loadPanel = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.consoleViews.loadPanel(req.user!, req.params.loadId));
  approvals = async (req: Request, res: Response) =>
    this.out(req, res, await this.consoleViews.approvals());
  cancellationRequests = async (req: Request, res: Response) =>
    this.out(req, res, await this.consoleViews.cancellationRequests());
  decideCancellation = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.consoleViews.decideCancellation(
        req.user!.id,
        req.params.cancellationId!,
        req.body,
      ),
    );
  analytics = async (req: Request, res: Response) => {
    const { from, to } = req.validatedQuery as { from: Date; to: Date };
    this.out(req, res, await this.consoleViews.analytics(from, to));
  };
  liveMap = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.consoleViews.liveMap(
        (req.validatedQuery ?? {}) as { q?: string; status?: LiveStatus[] },
      ),
    );

  // --- Tracking: charges, e-LR, carrier advance ---
  raiseCharge = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.raiseCharge(actorOf(req), req.params.loadId, req.body),
      201,
    );
  decideChargeAsAdmin = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.decideChargeAsAdmin(
        req.user!.id,
        req.params.loadId,
        req.params.chargeId!,
        req.body,
      ),
    );
  replyToChargeQuery = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.replyToChargeQuery(
        req.user!.id,
        req.params.loadId,
        req.params.chargeId!,
        req.body,
      ),
    );
  editLoadDetails = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.editLoadDetails(req.user!.id, req.params.loadId, req.body),
    );
  issueElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.issueElr(actorOf(req), req.params.loadId, req.body),
      201,
    );
  editElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.tracking.editElr(actorOf(req), req.params.loadId, req.body));
  cancelElr = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.cancelElr(req.user!.id, req.params.loadId, req.body.note),
    );
  elrRevisions = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.tracking.elrRevisions(req.params.loadId));
  raisePartnerAdvance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.raisePartnerAdvance(req.user!.id, req.params.loadId, req.body),
      201,
    );
  partnerPayments = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.listPartnerPayments(
        ((req.validatedQuery ?? {}) as { status?: PartnerPaymentStatus[] }).status ?? [
          'raised',
          'on_hold',
        ],
      ),
    );
  decidePartnerPayment = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.decidePartnerPayment(req.user!.id, req.params.paymentId!, req.body),
    );

  // --- Placement ---
  setPartnerClaims = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementService.setPartnerClaims(req.user!.id, req.params.partnerId, req.body),
    );
  updatePartnerProfile = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementService.updatePartnerProfile(req.user!, req.params.partnerId, req.body),
    );
  matchBrokers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.placementService.matchBrokers(req.params.sourcingId));
  placementInbox = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.placementService.inbox(
        req.user!.id,
        (req.validatedQuery ?? {}) as { mine?: boolean; tenantId?: string },
      ),
    );
  getRoster = async (req: Request, res: Response) =>
    this.out(req, res, await this.placementService.getRoster());
  saveRoster = async (req: Request, res: Response) =>
    this.out(req, res, await this.placementService.saveRoster(req.user!.id, req.body));
  moveOwner = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      req.body.team === 'tracking'
        ? await this.tracking.moveTrackingOwner(
            req.user!.id,
            req.params.sourcingId,
            req.body.ownerId,
          )
        : await this.placementService.moveOwner(
            req.user!.id,
            req.params.sourcingId,
            req.body.ownerId,
          ),
    );
  claimPlacement = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.placementService.claim(req.user!.id, req.params.sourcingId));
  claimTracking = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.tracking.claimLoad(req.user!.id, req.params.loadId));
  resendSimConsent = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.consoleViews.resendSimConsent(req.params.loadId));
  markLost = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementService.markLost(req.user!.id, req.params.sourcingId, req.body),
    );
  withdrawMemo = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.placementService.withdrawMemo(req.user!.id, req.params.loadId, req.body.reason),
    );

  // --- Approval ---
  listShippers = async (req: Request, res: Response) => {
    const query = req.validatedQuery as { search?: string; limit: number };
    this.out(req, res, await this.approvalService.listShippers(query.search, query.limit));
  };
  // --- Approval: the shipper accounts (the Shippers master, read-only) ---
  shipperAccounts = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.shipperDirectory.list(
        req.validatedQuery as Parameters<LsShipperDirectoryService['list']>[0],
      ),
    );
  shipperAccount = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.profile(req.params.tenantId));
  shipperAccountLoadingPoints = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.loadingPoints(req.params.tenantId));
  shipperAccountConsignees = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.consignees(req.params.tenantId));
  shipperAccountDocuments = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.documents(req.params.tenantId));
  shipperAccountInvoices = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.invoices(req.params.tenantId));
  shipperAccountTickets = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.shipperDirectory.tickets(req.params.tenantId));
  saveShipperAccountTerms = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.shipperDirectory.saveTerms(req.user!.id, req.params.tenantId, req.body),
    );
  shipperAccountActivity = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.shipperDirectory.activity(
        req.params.tenantId,
        (req.validatedQuery as { limit: number }).limit,
      ),
    );
  shipperRecentCustomers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.approvalService.pickers.recentCustomers(
        req.params.tenantId,
        (req.validatedQuery as { limit: number }).limit,
      ),
    );
  shipperCustomers = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    const query = req.validatedQuery as { search?: string; limit: number };
    this.out(
      req,
      res,
      await this.approvalService.pickers.customers(req.params.tenantId, query.search, query.limit),
    );
  };
  shipperUnloadingPoints = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.approvalService.pickers.unloadingPoints(
        req.params.tenantId,
        req.params.customerId as string,
        (req.validatedQuery as { search?: string }).search,
      ),
    );
  shipperLoadingPoints = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.approvalService.pickers.loadingPoints(
        req.params.tenantId,
        (req.validatedQuery as { search?: string }).search,
      ),
    );
  shipperCommodities = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.approvalService.pickers.commodities(
        req.params.tenantId,
        (req.validatedQuery as { search?: string }).search,
      ),
    );
  shipperTruckOptions = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      this.approvalService.pickers.truckOptions(
        req.validatedQuery as Parameters<LsApprovalService['pickers']['truckOptions']>[0],
      ),
    );
  shipperPostingRules = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.approvalService.pickers.rules());
  postForShipper = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.approvalService.postForShipper(
        req.user!,
        req.params.tenantId,
        req.body,
        req.header('Idempotency-Key') ?? undefined,
      ),
      201,
    );

  listPartners = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.listPartners());
  createPartner = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput),
      201,
    );
  updatePartner = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput, req.params.partnerId),
    );

  getTerms = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.sourcing.getTerms(req.params.tenantId));
  saveTerms = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    this.assertMayChangeMargin(req);
    this.out(req, res, await this.sourcing.saveTerms(req.user!.id, req.params.tenantId, req.body));
  };

  approvalQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.approvalQueue());
  approve = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    this.assertMayChangeMargin(req);
    this.out(req, res, await this.sourcing.approve(req.user!.id, req.params.sourcingId, req.body));
  };
  reject = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.reject(req.user!.id, req.params.sourcingId, req.body.reason),
    );

  loadBoard = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.loadBoard());
  placementQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.placementQueue());
  placement = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.sourcing.placement(req.params.sourcingId));
  partnerBid = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.recordPartnerBid(actorOf(req), req.params.sourcingId, req.body),
      201,
    );
  counterBroker = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.counterToBroker(req.user!.id, req.params.sourcingId, req.body),
    );

  sendBids = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.sendBids(req.user!.id, req.params.sourcingId, req.body.bids),
      201,
    );

  sendBid = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.sendBid(req.user!.id, req.params.sourcingId, req.body),
      201,
    );

  nameDriver = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.sourcing.nameDriver(req.user!.id, req.params.loadId, req.body));

  trackingQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.trackingQueue());
  partnerAdvance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.tracking.payPartnerAdvance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  rate = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.settlement.rate(req.user!.id, req.params.loadId, req.body));
  answerShipperCounter = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.answerShipperCounter(
        req.user!.id,
        req.params.loadId,
        req.params.bidId!,
        req.body,
      ),
    );
  updateDriverDocuments = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.updateDriverDocuments(req.user!.id, req.params.loadId, req.body),
    );

  rerunChecks = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.sourcing.rerunChecks(req.user!.id, req.params.loadId));
  verifyTruckManually = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.verifyTruckManually(req.user!.id, req.params.loadId, req.body),
    );
  verifyDriverManually = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.verifyDriverManually(req.user!.id, req.params.loadId, req.body),
    );
  confirmMemo = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.confirmMemoOnCall(req.user!.id, req.params.loadId, req.body),
    );
  setUnloadingDetails = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.settlement.setUnloadingDetails(req.user!.id, req.params.loadId, req.body),
    );
  listDocuments = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    const { history } = (req.validatedQuery ?? {}) as { history?: boolean };
    this.out(
      req,
      res,
      await this.settlement.listDocuments(req.user!, req.params.loadId, Boolean(history)),
    );
  };
  reviewDocument = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.settlement.reviewDocument(
        req.user!,
        req.params.loadId,
        req.params.documentId!,
        req.body,
      ),
    );
  decidePod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.settlement.decidePod(req.user!.id, req.params.loadId, req.body));
  // --- Customer support: claims ---
  claimsInbox = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.cs.inbox({
        actorId: req.user!.id,
        mine: Boolean(((req.validatedQuery ?? {}) as { mine?: boolean }).mine),
      }),
    );
  getClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.cs.getClaim(req.params.loadId));
  assignClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.cs.assign(req.user!.id, req.params.loadId, req.body.agentId));
  updateClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.cs.update(actorOf(req), req.params.loadId, req.body));
  closeClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.cs.close(req.user!.id, req.params.loadId, req.body.note));

  // --- Receivables ---
  receivablesInbox = async (req: Request, res: Response) =>
    this.out(req, res, await this.receivables.inbox());
  invoicePreview = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.preview(
        req.params.loadId,
        ((req.validatedQuery ?? {}) as { gstTreatment?: GstTreatment }).gstTreatment,
      ),
    );
  issueInvoice = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.issue(
        actorOf(req),
        req.params.loadId,
        (req.body as { gstTreatment?: GstTreatment } | undefined)?.gstTreatment,
      ),
      201,
    );
  receivablesBoard = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.board((req.validatedQuery ?? {}) as ReceivablesBoardQuery),
    );
  receivableLoad = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.receivables.loadDetail(req.params.loadId));
  recordLoadReceipt = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.recordLoadReceipt(actorOf(req), req.params.loadId, req.body),
      201,
    );
  recordPayerPod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.recordPayerPod(req.user!.id, req.params.invoiceId!, req.body),
    );
  invoiceDelivery = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.recordDelivery(req.user!.id, req.params.invoiceId!, req.body),
    );
  listReceipts = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.receivables.listReceipts(req.params.invoiceId!));
  recordReceipt = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.recordReceipt(req.user!.id, req.params.invoiceId!, req.body),
      201,
    );
  listUnclaimed = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.listUnclaimed(
        ((req.validatedQuery ?? {}) as { status?: UnclaimedStatus[] }).status ?? [
          'unclaimed',
          'under_review',
        ],
      ),
    );
  addUnclaimed = async (req: Request, res: Response) =>
    this.out(req, res, await this.receivables.addUnclaimed(req.user!.id, req.body), 201);
  updateUnclaimed = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.updateUnclaimed(req.user!.id, req.params.paymentId!, req.body),
    );
  matchUnclaimed = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.receivables.matchUnclaimed(req.user!.id, req.params.paymentId!, req.body),
      201,
    );

  // --- Payables: original POD and the carrier balance ---
  originalPods = async (req: Request, res: Response) =>
    this.out(
      req,
      res,
      await this.payables.listOriginalPods((req.validatedQuery ?? {}) as OriginalPodFilter),
    );
  updateOriginalPod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.payables.updateOriginalPod(req.user!.id, req.params.loadId, req.body),
    );
  logOriginalPodCall = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.payables.logCall(req.user!.id, req.params.loadId, req.body), 201);
  balancePreview = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.payables.balancePreview(req.params.loadId));
  raiseBalance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.payables.raiseBalance(req.user!.id, req.params.loadId, req.body),
      201,
    );
  partnerBalance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.payables.payBalance(req.user!.id, req.params.loadId, req.body));

  /** Everything Loadsmart holds on one load. */
  // Money as the caller's team may see it: Tracking gets carrier money only, CS none.
  loadDetail = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      redactMoney(await this.settlement.loadDetail(req.params.loadId), moneyVisibility(req.user!)),
    );
  // The carrier advance and balance with their UTR and payment advice — Tracking passes it on.
  partnerPaymentsOfLoad = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(res, await this.tracking.partnerPaymentsOf(actorOf(req), req.params.loadId));
}

/** The shipper's side of a Loadsmart load, on /v1/loads. */
export class LoadsmartShipperController {
  constructor(
    private readonly service: LsShipperService,
    private readonly receivables: LsReceivablesService,
  ) {}

  listCharges = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.listCharges(requireTenantId(req), req.params.loadId, req.user!.role),
    );
  decideCharges = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.decideCharges(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body.decisions,
        req.user!.role,
      ),
    );
  decideCharge = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.decideCharge(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.params.chargeId,
        req.body,
        req.user!.role,
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
  /** The shipper's "Generate invoice" on a delivered Loadsmart load: the same issue as Receivables'
   *  (same checks — POD approved, no charge waiting, GSTIN on file — and Delivered → Invoice
   *  generated), run for the shipper's own load only. */
  generateOwnInvoice = async (req: Request<LoadsmartRouteParams>, res: Response) => {
    await this.service.assertOwnLoadsmartLoad(requireTenantId(req), req.params.loadId);
    respond(res, await this.receivables.issue(actorOf(req), req.params.loadId));
  };
  documentsBundle = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.documentsBundle(requireTenantId(req), req.user!.role, req.params.loadId),
    );
}
