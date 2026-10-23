import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LoadBidService, RecordBidInput } from './bids/load-bid.service';
import { AcceptMemoInput, LoadMemoService, NameDriverInput } from './memo/load-memo.service';
import { LoadParams } from './utils/load.interface';

type BidParams = LoadParams & { bidId: string };

/** Bids, indent acceptance, driver and load memo — Sourcing (stages 1–3) for market and indent. */
export class LoadSourcingController {
  constructor(
    private readonly bidService: LoadBidService,
    private readonly memoService: LoadMemoService,
  ) {}

  listBids = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.bidService.listForLoad(requireTenantId(req), req.params.loadId));
  };

  recordBid = async (req: Request<LoadParams>, res: Response) => {
    const bid = await this.bidService.recordBid(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as RecordBidInput,
    );
    respond(res, bid, 201);
  };

  setBidTruck = async (req: Request<BidParams>, res: Response) => {
    const bid = await this.bidService.setBidTruck(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.params.bidId,
      (req.body as { vehicleNumber: string }).vehicleNumber,
    );
    respond(res, bid);
  };

  acceptBid = async (req: Request<BidParams>, res: Response) => {
    const load = await this.bidService.acceptBid(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.params.bidId,
    );
    respond(res, load);
  };

  recordIndentAcceptance = async (req: Request<LoadParams>, res: Response) => {
    const bid = await this.bidService.recordIndentAcceptance(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      (req.body as { vehicleNumber: string }).vehicleNumber,
    );
    respond(res, bid, 201);
  };

  nameDriver = async (req: Request<LoadParams>, res: Response) => {
    const memo = await this.memoService.nameDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as NameDriverInput,
    );
    respond(res, memo, 201);
  };

  getMemo = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.memoService.getCurrent(requireTenantId(req), req.params.loadId));
  };

  resendMemo = async (req: Request<LoadParams>, res: Response) => {
    const memo = await this.memoService.resend(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
    );
    respond(res, memo, 201);
  };

  acceptMemo = async (req: Request<LoadParams>, res: Response) => {
    const memo = await this.memoService.accept(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as AcceptMemoInput,
    );
    respond(res, memo);
  };
}
