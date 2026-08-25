import { Request, Response } from 'express';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';
import { ShipperAnalyticsRangeInput } from './shipper-analytics.interface';
import { ShipperAnalyticsService } from './shipper-analytics.service';

export class ShipperAnalyticsController {
  constructor(private readonly service: ShipperAnalyticsService) {}

  getOverview = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getOverview(
        requireTenantId(req),
        req.validatedQuery as ShipperAnalyticsRangeInput,
      ),
    );
  };
}
