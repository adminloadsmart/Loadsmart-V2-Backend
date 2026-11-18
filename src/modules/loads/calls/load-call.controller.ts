import { Request, Response } from 'express';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';
import { LoadsmartCallTeam } from '../utils/loads.types';
import { LoadCallService, LogCallInput } from './load-call.service';

type LoadParams = { loadId: string };
type CallParams = { callId: string };

export class LoadCallController {
  constructor(private readonly calls: LoadCallService) {}

  listShipperCalls = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.calls.listForShipper(requireTenantId(req), req.params.loadId));
  };

  logShipperCall = async (req: Request<LoadParams>, res: Response) => {
    const call = await this.calls.logShipperCall(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as LogCallInput,
    );
    respond(res, call, 201);
  };

  listLoadsmartCalls = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.calls.listForLoadsmart(req.params.loadId));
  };

  logLoadsmartCall = async (req: Request<LoadParams>, res: Response) => {
    const { team, ...input } = req.body as LogCallInput & { team: LoadsmartCallTeam };
    respond(
      res,
      await this.calls.logLoadsmartCall(req.user!.id, req.params.loadId, team, input),
      201,
    );
  };

  myReminders = async (req: Request, res: Response) => {
    respond(res, await this.calls.myReminders(req.user!.id));
  };

  reminderDone = async (req: Request<CallParams>, res: Response) => {
    respond(res, await this.calls.markReminderDone(req.user!.id, req.params.callId));
  };
}
