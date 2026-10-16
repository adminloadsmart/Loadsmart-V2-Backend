import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { MastersSummaryService } from './summary.service';

export class MastersSummaryController {
  constructor(private readonly service: MastersSummaryService) {}

  summary = async (req: Request, res: Response) =>
    respond(res, await this.service.summary(requireTenantId(req)));
}
