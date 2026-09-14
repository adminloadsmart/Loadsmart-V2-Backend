import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { DriverService } from './driver.service';
import { LoadService } from '../loads/load.service';
import { ListLoadsInput } from '../loads/utils/load.interface';

/**
 * The driver-app self-service layer — "do some stuff as myself". Every method is implicitly
 * scoped to req.driver!.id/req.driver!.tenantId (set by createDriverAuth), never a
 * client-supplied id, so there is no IDOR surface to review here by construction. Calls straight
 * into the same DriverService/LoadService the staff-facing masters/loads routes use — no
 * duplicated queries, no repository of its own. See docs/driver-auth.md.
 */
export class DriverPortalController {
  constructor(
    private readonly driverService: DriverService,
    private readonly loadService: LoadService,
  ) {}

  getMe = async (req: Request, res: Response) => {
    const driver = await this.driverService.getDriver(req.driver!.tenantId, req.driver!.id);
    respond(res, driver);
  };

  getMyStatus = async (req: Request, res: Response) => {
    const status = await this.driverService.getOperationalStatus(
      req.driver!.tenantId,
      req.driver!.id,
    );
    respond(res, status);
  };

  // actorId === driverId here — the driver is setting their own status, same
  // DriverService.setOperationalStatus code path staff already use (driver.controller.ts), just
  // invoked by the driver themselves.
  updateMyStatus = async (req: Request, res: Response) => {
    const status = await this.driverService.setOperationalStatus(
      req.driver!.tenantId,
      req.driver!.id,
      req.driver!.id,
      req.body,
    );
    respond(res, status);
  };

  // Read-only — trip metrics read as ops-computed KPIs (see driver.service.ts's
  // recordTripMetrics, staff-only), not driver-self-reported data.
  getMyTripMetrics = async (req: Request, res: Response) => {
    const metrics = await this.driverService.listTripMetrics(req.driver!.tenantId, req.driver!.id);
    respond(res, metrics);
  };

  getMyLoads = async (req: Request, res: Response) => {
    const loads = await this.loadService.list(req.driver!.tenantId, {
      ...(req.validatedQuery as ListLoadsInput),
      driverId: req.driver!.id,
    });
    respond(res, loads);
  };
}
