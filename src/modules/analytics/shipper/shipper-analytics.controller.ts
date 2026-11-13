import { Request, Response } from 'express';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';
import { ShipperAnalyticsFilters } from './shipper-analytics.interface';
import { ShipperAnalyticsService } from './shipper-analytics.service';
import { SpendMeasure } from './utils/shipper-analytics.constants';

export class ShipperAnalyticsController {
  constructor(private readonly service: ShipperAnalyticsService) {}

  getFilters = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getFilters(
        requireTenantId(req),
        req.validatedQuery as ShipperAnalyticsFilters,
      ),
    );
  };

  getOverview = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getOverview(
        requireTenantId(req),
        req.user!,
        req.validatedQuery as ShipperAnalyticsFilters,
      ),
    );
  };

  getFreightSpend = async (req: Request, res: Response) => {
    const query = req.validatedQuery as ShipperAnalyticsFilters & { measure: SpendMeasure };
    respond(res, await this.service.getFreightSpend(requireTenantId(req), query, query.measure));
  };

  getTransporters = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getTransporters(
        requireTenantId(req),
        req.validatedQuery as ShipperAnalyticsFilters,
      ),
    );
  };

  getService = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getService(
        requireTenantId(req),
        req.validatedQuery as ShipperAnalyticsFilters,
      ),
    );
  };

  getBilling = async (req: Request, res: Response) => {
    respond(
      res,
      await this.service.getBilling(
        requireTenantId(req),
        req.validatedQuery as ShipperAnalyticsFilters,
      ),
    );
  };
}
