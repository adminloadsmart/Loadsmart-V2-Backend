import { Request, Response } from 'express';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { respond } from '../../shared/responses/respond';
import { DashboardsService } from './dashboards.service';
import { FleetActivityRangeInput } from './utils/dashboards.interface';

export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  getFleetActivity = async (req: Request, res: Response) => {
    const summary = await this.dashboardsService.getFleetActivity(
      requireTenantId(req),
      req.validatedQuery as FleetActivityRangeInput,
    );
    respond(res, summary);
  };
}
