import { Request, Response } from 'express';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { respond } from '../../shared/responses/respond';
import { DashboardsService } from './dashboards.service';
import { FleetActivityRangeInput, LoadsSummaryRangeInput } from './utils/dashboards.interface';

export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  getFleetActivity = async (req: Request, res: Response) => {
    const summary = await this.dashboardsService.getFleetActivity(
      requireTenantId(req),
      req.validatedQuery as FleetActivityRangeInput,
    );
    respond(res, summary);
  };

  getLoadsSummary = async (req: Request, res: Response) => {
    const summary = await this.dashboardsService.getLoadsSummary(
      requireTenantId(req),
      req.validatedQuery as LoadsSummaryRangeInput,
    );
    respond(res, summary);
  };

  listPendingApprovals = async (req: Request, res: Response) => {
    const result = await this.dashboardsService.listPendingApprovals(
      requireTenantId(req),
      req.user!,
    );
    respond(res, result);
  };
}
