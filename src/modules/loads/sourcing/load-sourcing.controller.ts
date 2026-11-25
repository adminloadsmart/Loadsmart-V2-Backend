import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { LoadBidService } from '../bids/load-bid.service';
import { LoadMemoService } from '../memo/load-memo.service';
import { CancelTruckInput, TruckCancellationService } from './truck-cancellation.service';
import { LoadParams, WithdrawLoadInput } from '../utils/load.interface';
import { RecordBidInput, LoadBidParams } from '../utils/load-bid.interface';
import { CancelLoadInput, LoadCancelService } from './load-cancel.service';
import type {
  CounterAnswerInput,
  CounterBidInput,
  IndentAcceptanceInput,
} from '../utils/load-bid.interface';
import { AcceptMemoInput, NameDriverInput } from '../utils/load-memo.interface';
import type {
  ManualDriverCheckInput,
  ManualTruckCheckInput,
} from '../utils/load-verification.interface';

/** Bids, indent acceptance, driver and load memo — Sourcing (stages 1–3) for market and indent. */
export class LoadSourcingController {
  constructor(
    private readonly bidService: LoadBidService,
    private readonly memoService: LoadMemoService,
    private readonly truckCancellation: TruckCancellationService,
    private readonly loadCancel: LoadCancelService,
  ) {}

  cancellationOptions = async (req: Request<LoadParams>, res: Response) =>
    respond(res, await this.loadCancel.options(requireTenantId(req), req.params.loadId));

  cancelLoad = async (req: Request<LoadParams>, res: Response) =>
    respond(
      res,
      await this.loadCancel.cancel(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body as CancelLoadInput,
      ),
    );

  withdrawLoad = async (req: Request<LoadParams>, res: Response) =>
    respond(
      res,
      await this.loadCancel.withdraw(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body as WithdrawLoadInput,
      ),
    );

  cancelTruck = async (req: Request<LoadParams>, res: Response) =>
    respond(
      res,
      await this.truckCancellation.cancel(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.body as CancelTruckInput,
      ),
    );

  listTruckCancellations = async (req: Request<LoadParams>, res: Response) =>
    respond(res, await this.truckCancellation.listForLoad(requireTenantId(req), req.params.loadId));

  listBids = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.bidService.listForLoad(requireTenantId(req), req.params.loadId));
  };

  extendBidWindow = async (req: Request<LoadParams>, res: Response) =>
    respond(
      res,
      await this.bidService.extendBidWindow(requireTenantId(req), req.user!.id, req.params.loadId),
    );

  recordBid = async (req: Request<LoadParams>, res: Response) => {
    const bid = await this.bidService.recordBid(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as RecordBidInput,
    );
    respond(res, bid, 201);
  };

  setBidTruck = async (req: Request<LoadBidParams>, res: Response) => {
    const bid = await this.bidService.setBidTruck(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.params.bidId,
      (req.body as { vehicleNumber: string }).vehicleNumber,
    );
    respond(res, bid);
  };

  acceptBid = async (req: Request<LoadBidParams>, res: Response) => {
    const load = await this.bidService.acceptBid(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.params.bidId,
    );
    respond(res, load);
  };

  counterBid = async (req: Request<LoadBidParams>, res: Response) =>
    respond(
      res,
      await this.bidService.counterBid(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.params.bidId,
        req.body as CounterBidInput,
      ),
    );

  answerCounter = async (req: Request<LoadBidParams>, res: Response) =>
    respond(
      res,
      await this.bidService.answerCounter(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.params.bidId,
        req.body as CounterAnswerInput,
      ),
    );

  rejectBid = async (req: Request<LoadBidParams>, res: Response) =>
    respond(
      res,
      await this.bidService.rejectBid(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        req.params.bidId,
        (req.body as { reason?: string }).reason,
      ),
    );

  recordIndentAcceptance = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.bidService.acceptIndentOnBehalf(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as IndentAcceptanceInput,
    );
    respond(res, result, 201);
  };

  nameDriver = async (req: Request<LoadParams>, res: Response) => {
    const tenantId = requireTenantId(req);
    const input = req.body as NameDriverInput;
    // An indent not awarded yet: the truck awards it to the indent's transporter first.
    await this.bidService.awardWaitingIndent(
      tenantId,
      req.user!.id,
      req.params.loadId,
      input.vehicleNumber,
      input.reason,
    );
    const result = await this.memoService.nameDriver(
      tenantId,
      req.user!.id,
      req.params.loadId,
      input,
    );
    respond(res, result, result.memo ? 201 : 200);
  };

  recordIndentRejection = async (req: Request<LoadParams>, res: Response) =>
    respond(
      res,
      await this.bidService.recordIndentRejection(
        requireTenantId(req),
        req.user!.id,
        req.params.loadId,
        (req.body as { transporterId: string }).transporterId,
        (req.body as { reason: string }).reason,
      ),
    );

  rerunChecks = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.memoService.rerunChecks(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
    );
    respond(res, result, result.memo ? 201 : 200);
  };

  verifyTruckManually = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.memoService.verifyTruckManually(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as ManualTruckCheckInput,
    );
    respond(res, result, result.memo ? 201 : 200);
  };

  verifyDriverManually = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.memoService.verifyDriverManually(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as ManualDriverCheckInput,
    );
    respond(res, result, result.memo ? 201 : 200);
  };

  listMemos = async (req: Request<LoadParams>, res: Response) =>
    respond(res, await this.memoService.listVersions(requireTenantId(req), req.params.loadId));

  getChecks = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.memoService.getChecks(requireTenantId(req), req.params.loadId));
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
