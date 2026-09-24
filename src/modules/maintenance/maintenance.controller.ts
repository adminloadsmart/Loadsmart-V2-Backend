import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceOverviewService } from './maintenance-overview.service';
import { TyreService } from './tyre.service';
import { BatteryService } from './battery.service';
import {
  BatteryPackParams,
  JobParams,
  ListJobsInput,
  PeriodInput,
  TyreParams,
  VehicleParams,
} from './maintenance.interface';
import { canSeeMaintenanceCosts } from './utils/cost-visibility';

export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
    private readonly overviewService: MaintenanceOverviewService,
    private readonly tyreService: TyreService,
    private readonly batteryService: BatteryService,
  ) {}

  /* Screen reads — every tenant seat; money fields only with MAINTENANCE_COSTS_VIEW. */

  getOverview = async (req: Request, res: Response) => {
    const overview = await this.overviewService.getOverview(
      requireTenantId(req),
      req.validatedQuery as PeriodInput,
      canSeeMaintenanceCosts(req),
    );
    respond(res, overview);
  };

  listServiceDue = async (req: Request, res: Response) => {
    respond(res, await this.maintenanceService.listServiceDue(requireTenantId(req)));
  };

  listBreakdowns = async (req: Request, res: Response) => {
    respond(
      res,
      await this.maintenanceService.listOpenBreakdowns(
        requireTenantId(req),
        canSeeMaintenanceCosts(req),
      ),
    );
  };

  listTyres = async (req: Request, res: Response) => {
    respond(res, await this.tyreService.listQueue(requireTenantId(req)));
  };

  listBatteries = async (req: Request, res: Response) => {
    respond(res, await this.batteryService.listQueue(requireTenantId(req)));
  };

  listJobs = async (req: Request, res: Response) => {
    const jobs = await this.maintenanceService.listJobs(
      requireTenantId(req),
      req.validatedQuery as ListJobsInput,
      canSeeMaintenanceCosts(req),
    );
    respond(res, jobs);
  };

  /* Workshop writes — MAINTENANCE_MANAGE. */

  logService = async (req: Request, res: Response) => {
    const job = await this.maintenanceService.logService(
      requireTenantId(req),
      req.user!.id,
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job, 201);
  };

  openBreakdown = async (req: Request, res: Response) => {
    const job = await this.maintenanceService.openBreakdown(
      requireTenantId(req),
      req.user!.id,
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job, 201);
  };

  updateService = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.updateJob(
      requireTenantId(req),
      req.user!.id,
      req.params.jobId,
      'service',
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  completeService = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.completeService(
      requireTenantId(req),
      req.user!.id,
      req.params.jobId,
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  updateBreakdown = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.updateJob(
      requireTenantId(req),
      req.user!.id,
      req.params.jobId,
      'breakdown',
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  closeBreakdown = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.closeBreakdown(
      requireTenantId(req),
      req.user!.id,
      req.params.jobId,
      req.body ?? {},
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  setServicePolicy = async (req: Request<VehicleParams>, res: Response) => {
    const policy = await this.maintenanceService.setServicePolicy(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, policy);
  };

  fitTyre = async (req: Request, res: Response) => {
    const tyre = await this.tyreService.fitTyre(requireTenantId(req), req.user!.id, req.body);
    respond(res, tyre, 201);
  };

  recordTyreReading = async (req: Request<TyreParams>, res: Response) => {
    const reading = await this.tyreService.recordReading(
      requireTenantId(req),
      req.user!.id,
      req.params.tyreId,
      req.body,
    );
    respond(res, reading, 201);
  };

  removeTyre = async (req: Request<TyreParams>, res: Response) => {
    const tyre = await this.tyreService.removeTyre(
      requireTenantId(req),
      req.user!.id,
      req.params.tyreId,
      req.body,
    );
    respond(res, tyre);
  };

  registerBatteryPack = async (req: Request, res: Response) => {
    const pack = await this.batteryService.registerPack(
      requireTenantId(req),
      req.user!.id,
      req.body,
    );
    respond(res, pack, 201);
  };

  recordBatteryReading = async (req: Request<BatteryPackParams>, res: Response) => {
    const reading = await this.batteryService.recordReading(
      requireTenantId(req),
      req.user!.id,
      req.params.packId,
      req.body,
    );
    respond(res, reading, 201);
  };
}
