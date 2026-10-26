import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LsSourcingService, PartnerInput } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';

type Params = Record<string, string>;
const actorOf = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

/** The Loadsmart ops console — platform staff, across every shipper. */
export class LoadsmartOpsController {
  constructor(
    private readonly sourcing: LsSourcingService,
    private readonly settlement: LsSettlementService,
  ) {}

  listPartners = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.listPartners());
  createPartner = async (req: Request, res: Response) =>
    respond(res, await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput), 201);
  updatePartner = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.sourcing.savePartner(req.user!.id, req.body as PartnerInput, req.params.partnerId),
    );

  getTerms = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.getTerms(req.params.tenantId));
  saveTerms = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.saveTerms(req.user!.id, req.params.tenantId, req.body));

  approvalQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.approvalQueue());
  approve = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.approve(req.user!.id, req.params.sourcingId, req.body));
  reject = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.reject(req.user!.id, req.params.sourcingId, req.body.reason));

  loadBoard = async (_req: Request, res: Response) => respond(res, await this.sourcing.loadBoard());
  placementQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.placementQueue());
  placement = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.placement(req.params.sourcingId));
  partnerBid = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.sourcing.recordPartnerBid(actorOf(req), req.params.sourcingId, req.body),
      201,
    );
  sendBid = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.sendBid(req.user!.id, req.params.sourcingId, req.body), 201);

  nameDriver = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.nameDriver(req.user!.id, req.params.loadId, req.body));
  verificationQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.verificationQueue());
  approveVerification = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.sourcing.approveVerification(req.user!.id, req.params.loadId, req.body),
    );

  trackingQueue = async (_req: Request, res: Response) =>
    respond(res, await this.sourcing.trackingQueue());
  markStage = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.markStage(req.user!.id, req.params.loadId, req.body.toStatus));
  uploadPapers = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.uploadPapers(actorOf(req), req.params.loadId, req.body));
  approvePapers = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.approvePapers(req.user!.id, req.params.loadId, req.body));
  raiseCharge = async (req: Request<Params>, res: Response) =>
    respond(res, await this.sourcing.raiseCharge(req.user!.id, req.params.loadId, req.body), 201);
  partnerAdvance = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.sourcing.payPartnerAdvance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  reviewPod = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.settlement.reviewPod(
        req.user!.id,
        req.params.loadId,
        req.body.decision,
        req.body.reason,
      ),
    );
  csQueue = async (_req: Request, res: Response) => respond(res, await this.settlement.csQueue());
  settleClaim = async (req: Request<Params>, res: Response) =>
    respond(res, await this.settlement.settleClaim(req.user!.id, req.params.loadId, req.body));
  podQueue = async (_req: Request, res: Response) => respond(res, await this.settlement.podQueue());
  rate = async (req: Request<Params>, res: Response) =>
    respond(res, await this.settlement.rate(req.user!.id, req.params.loadId, req.body));
  originalPod = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.settlement.markOriginalPodReceived(req.user!.id, req.params.loadId, req.body),
    );
  invoice = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.settlement.generateInvoice(actorOf(req), req.params.loadId, req.body),
      201,
    );
  receivablesQueue = async (_req: Request, res: Response) =>
    respond(res, await this.settlement.receivablesQueue());
  decidePayment = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.settlement.decidePayment(
        req.user!.id,
        req.params.loadId,
        req.params.paymentId,
        req.body.decision,
        req.body.reason,
      ),
    );
  partnerBalance = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.settlement.payPartnerBalance(req.user!.id, req.params.loadId, req.body),
      201,
    );

  /** Everything Loadsmart holds on one load. */
  loadDetail = async (req: Request<Params>, res: Response) =>
    respond(res, await this.settlement.loadDetail(req.params.loadId));
}

/** The shipper's side of a Loadsmart load, on /v1/loads. */
export class LoadsmartShipperController {
  constructor(private readonly service: LsShipperService) {}

  listCharges = async (req: Request<Params>, res: Response) =>
    respond(res, await this.service.listCharges(requireTenantId(req), req.params.loadId));
  decideCharge = async (req: Request<Params>, res: Response) =>
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
  unloadingCharge = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.service.enterUnloadingCharge(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
      201,
    );
  unloadingContact = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.service.setUnloadingContact(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
    );
  getClaim = async (req: Request<Params>, res: Response) =>
    respond(res, await this.service.getClaim(requireTenantId(req), req.params.loadId));
  claimValue = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.service.addClaimValue(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body,
      ),
    );
  invoice = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.service.getInvoice(requireTenantId(req), req.user!.role, req.params.loadId),
    );
  documentsBundle = async (req: Request<Params>, res: Response) =>
    respond(
      res,
      await this.service.documentsBundle(requireTenantId(req), req.user!.role, req.params.loadId),
    );
}
