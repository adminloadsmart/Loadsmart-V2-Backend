import { Request, Response } from 'express';
import { FleetAnalyticsService } from './fleet-analytics.service';
import { FleetAnalyticsFilters } from './utils/fleet-analytics.interface';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { respond } from '../../../shared/responses/respond';

export class FleetAnalyticsController {
  constructor(private readonly fleetAnalyticsService: FleetAnalyticsService) {}

  getFilters = async (req: Request, res: Response) => {
    respond(res, await this.fleetAnalyticsService.getFilters(requireTenantId(req)));
  };

  getSummary = async (req: Request, res: Response) => {
    respond(res, await this.fleetAnalyticsService.getSummary(requireTenantId(req), filtersOf(req)));
  };

  getOverview = async (req: Request, res: Response) => {
    respond(
      res,
      await this.fleetAnalyticsService.getOverview(requireTenantId(req), filtersOf(req)),
    );
  };

  getUtilisation = async (req: Request, res: Response) => {
    respond(
      res,
      await this.fleetAnalyticsService.getUtilisation(requireTenantId(req), filtersOf(req)),
    );
  };

  getCost = async (req: Request, res: Response) => {
    respond(res, await this.fleetAnalyticsService.getCost(requireTenantId(req), filtersOf(req)));
  };

  getEnergy = async (req: Request, res: Response) => {
    respond(res, await this.fleetAnalyticsService.getEnergy(requireTenantId(req), filtersOf(req)));
  };

  getMaintenance = async (req: Request, res: Response) => {
    respond(
      res,
      await this.fleetAnalyticsService.getMaintenance(requireTenantId(req), filtersOf(req)),
    );
  };

  getOperations = async (req: Request, res: Response) => {
    respond(
      res,
      await this.fleetAnalyticsService.getOperations(requireTenantId(req), filtersOf(req)),
    );
  };

  getCompliance = async (req: Request, res: Response) => {
    respond(
      res,
      await this.fleetAnalyticsService.getCompliance(requireTenantId(req), filtersOf(req)),
    );
  };
}

function filtersOf(req: Request): FleetAnalyticsFilters {
  return req.validatedQuery as FleetAnalyticsFilters;
}
