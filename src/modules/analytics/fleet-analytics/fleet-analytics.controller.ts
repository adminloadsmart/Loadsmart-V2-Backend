import { Request, Response } from 'express';
import { FleetAnalyticsService } from './fleet-analytics.service';
import { FleetAnalyticsDateRange } from './utils/fleet-analytics.interface';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';

export class FleetAnalyticsController {
  constructor(private readonly fleetAnalyticsService: FleetAnalyticsService) {}

  getOverview = async (req: Request, res: Response) => {
    const overview = await this.fleetAnalyticsService.getOverview(
      requireTenantId(req),
      req.validatedQuery as FleetAnalyticsDateRange,
    );
    respond(res, overview);
  };
}
