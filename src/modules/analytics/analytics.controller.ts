import { Request, Response } from 'express';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { respond } from '../../shared/responses/respond';
import { AnalyticsService } from './analytics.service';

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  getShipperOverview = async (req: Request, res: Response) => {
    respond(res, await this.analyticsService.getShipperOverview(requireTenantId(req)));
  };
}
