import { Request, Response } from 'express';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';
import { MessageLogQueryService } from './message-log-query.service';

type LoadParams = { loadId: string };

export class SentLogController {
  constructor(private readonly query: MessageLogQueryService) {}

  shipperMessages = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.query.shipperView(requireTenantId(req), req.params.loadId));
  };

  adminMessages = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.query.adminView(req.params.loadId));
  };

  whatsappLog = async (req: Request<LoadParams>, res: Response) => {
    respond(res, await this.query.whatsappView(req.params.loadId));
  };
}
