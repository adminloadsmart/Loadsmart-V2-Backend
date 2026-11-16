import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { hasPermission } from '../../shared/middleware/require-permission.middleware';
import { LS_MARGIN_MANAGE, LS_MARGIN_VIEW } from '../../shared/constants/permissions';
import { AuthorizationError } from '../../shared/errors';
import { redactMargin } from './redact-margin';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LsSourcingService } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';
import { LoadsmartActor, LoadsmartRouteParams, PartnerInput } from './loadsmart.interface';

const actorOf = (req: Request): LoadsmartActor => ({ id: req.user!.id, role: req.user!.role });

/** The Loadsmart ops console — platform staff, across every shipper. */
export class LoadsmartOpsController {
  constructor(
    private readonly sourcing: LsSourcingService,
    private readonly settlement: LsSettlementService,
  ) {}

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
  sendBid = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.sendBid(req.user!.id, req.params.sourcingId, req.body),
      201,
    );

  nameDriver = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.sourcing.nameDriver(req.user!.id, req.params.loadId, req.body));
  verificationQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.verificationQueue());
  approveVerification = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.approveVerification(req.user!.id, req.params.loadId, req.body),
    );

  trackingQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.sourcing.trackingQueue());
  partnerAdvance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.sourcing.payPartnerAdvance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  csQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.settlement.csQueue());
  podQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.settlement.podQueue());
  rate = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.settlement.rate(req.user!.id, req.params.loadId, req.body));
  originalPod = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.settlement.markOriginalPodReceived(req.user!.id, req.params.loadId, req.body),
    );
  receivablesQueue = async (req: Request, res: Response) =>
    this.out(req, res, await this.settlement.receivablesQueue());
  partnerBalance = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(
      req,
      res,
      await this.settlement.payPartnerBalance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  /** Everything Loadsmart holds on one load. */
  loadDetail = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    this.out(req, res, await this.settlement.loadDetail(req.params.loadId));
}

/** The shipper's side of a Loadsmart load, on /v1/loads. */
export class LoadsmartShipperController {
  constructor(
    private readonly service: LsShipperService,
    private readonly sourcing: LsSourcingService,
    private readonly settlement: LsSettlementService,
  ) {}

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
  unloadingContact = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.service.setUnloadingContact(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
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
  approvePapers = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.sourcing.approvePapers(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
    );
  settleClaim = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.settlement.settleClaim(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
    );
  generateInvoice = async (req: Request<LoadsmartRouteParams>, res: Response) =>
    respond(
      res,
      await this.settlement.generateInvoice(
        requireTenantId(req),
        actorOf(req),
        req.params.loadId,
        req.body,
      ),
      201,
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
