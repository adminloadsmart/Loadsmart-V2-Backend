import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceOverviewService } from './maintenance-overview.service';
import { TyreService } from './tyre.service';
import { BatteryService } from './battery.service';
import {
  Actor,
  BatteryPackParams,
  JobParams,
  ListJobsInput,
  PeriodInput,
  TyreParams,
  VehicleParams,
} from './maintenance.interface';
import { canSeeMaintenanceCosts } from './utils/cost-visibility';

/** The writer — the role resolves an attached invoice's storage key. */
const actorOf = (req: Request): Actor => ({ id: req.user!.id, role: req.user!.role });

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

  listInWorkshop = async (req: Request, res: Response) => {
    respond(
      res,
      await this.maintenanceService.listInWorkshop(
        requireTenantId(req),
        canSeeMaintenanceCosts(req),
      ),
    );
  };

  listBlockedOnPapers = async (req: Request, res: Response) => {
    respond(res, await this.maintenanceService.listBlockedOnPapers(requireTenantId(req)));
  };

  listTyres = async (req: Request, res: Response) => {
    respond(res, await this.tyreService.listQueue(requireTenantId(req)));
  };

  getVehicleTyres = async (req: Request<VehicleParams>, res: Response) => {
    respond(
      res,
      await this.tyreService.getVehicleTyres(requireTenantId(req), req.params.vehicleId),
    );
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
      actorOf(req),
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job, 201);
  };

  checkInService = async (req: Request, res: Response) => {
    const job = await this.maintenanceService.checkInService(
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
      actorOf(req),
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
      actorOf(req),
      req.params.jobId,
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  releaseFromWorkshop = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.releaseFromWorkshop(
      requireTenantId(req),
      req.user!.id,
      req.params.jobId,
      req.body ?? {},
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  openBreakdown = async (req: Request, res: Response) => {
    const job = await this.maintenanceService.openBreakdown(
      requireTenantId(req),
      actorOf(req),
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, job, 201);
  };

  updateBreakdown = async (req: Request<JobParams>, res: Response) => {
    const job = await this.maintenanceService.updateJob(
      requireTenantId(req),
      actorOf(req),
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
      actorOf(req),
      req.params.jobId,
      req.body ?? {},
      canSeeMaintenanceCosts(req),
    );
    respond(res, job);
  };

  setWorkshopStatus = async (req: Request<VehicleParams>, res: Response) => {
    const result = await this.maintenanceService.setWorkshopStatus(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body.status,
      canSeeMaintenanceCosts(req),
    );
    respond(res, result);
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

  recordTyreWork = async (req: Request, res: Response) => {
    const result = await this.tyreService.recordTyreWork(
      requireTenantId(req),
      actorOf(req),
      req.body,
      canSeeMaintenanceCosts(req),
    );
    respond(res, result, 201);
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
