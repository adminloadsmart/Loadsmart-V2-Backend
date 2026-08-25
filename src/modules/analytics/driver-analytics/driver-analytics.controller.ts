import { Request, Response } from 'express';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';
import { DriverAnalyticsService } from './driver-analytics.service';
import { DriverAnalyticsDateRange } from './utils/driver-analytics.interface';

export class DriverAnalyticsController {
  constructor(private readonly driverAnalyticsService: DriverAnalyticsService) {}

  getOverview = async (req: Request<{ driverId: string }>, res: Response) => {
    const overview = await this.driverAnalyticsService.getOverview(
      requireTenantId(req),
      req.params.driverId,
      req.validatedQuery as DriverAnalyticsDateRange,
    );
    respond(res, overview);
  };
}
