import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { LinkParams } from './fleet-driver-link.interface';
import { VehicleParams } from '../vehicle/vehicle.interface';
import { DriverParams } from '../driver/drivers.interface';
import { FleetDriverLinkService } from './fleet-driver-link.service';

export class FleetDriverLinkController {
  constructor(private readonly fleetDriverLinkService: FleetDriverLinkService) {}

  linkDriver = async (req: Request<VehicleParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.linkDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, link, 201);
  };

  listVehicleLinks = async (req: Request<VehicleParams>, res: Response) => {
    const links = await this.fleetDriverLinkService.listVehicleLinks(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, links);
  };

  listDriverLinks = async (req: Request<DriverParams>, res: Response) => {
    const links = await this.fleetDriverLinkService.listDriverLinks(
      requireTenantId(req),
      req.params.driverId,
    );
    respond(res, links);
  };

  setLinkPrimary = async (req: Request<LinkParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.setPrimary(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
    );
    respond(res, link);
  };

  endLink = async (req: Request<LinkParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.endLink(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
      req.body.linkedTo,
    );
    respond(res, link);
  };

  deleteLink = async (req: Request<LinkParams>, res: Response) => {
    await this.fleetDriverLinkService.deleteLink(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
    );
    respond(res, { success: true });
  };
}
