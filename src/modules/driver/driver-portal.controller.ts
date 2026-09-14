import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { DriverService } from './driver.service';
import { LoadService } from '../loads/load.service';
import {
  ListLoadsInput,
  LoadParams,
  UpdateLoadStatusInput,
  UploadPodInput,
} from '../loads/utils/load.interface';
import { StorageService } from '../storage/storage.service';
import { FileParams, GenerateUploadUrlInput } from '../storage/storage.types';

/**
 * The driver-app self-service layer — "do some stuff as myself". Every method is implicitly
 * scoped to req.driver!.id/req.driver!.tenantId (set by createDriverAuth), never a
 * client-supplied id, so there is no IDOR surface to review here by construction. Calls straight
 * into the same DriverService/LoadService the staff-facing masters/loads routes use — no
 * duplicated queries, no repository of its own. See docs/driver-auth.md.
 *
 * updateMyLoadStatus/uploadMyPod are the one exception to "implicitly scoped" above — :loadId is
 * client-supplied, so ownership (the load must actually be this driver's own) is enforced inside
 * LoadService via the driverOwnerId param, not here.
 */
export class DriverPortalController {
  constructor(
    private readonly driverService: DriverService,
    private readonly loadService: LoadService,
    private readonly storageService: StorageService,
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

  // Manual tracking advance (at_plant -> in_transit -> reached_delivery_point) for a load this
  // driver is the assigned own-fleet driver of. Same LoadService.updateStatus the staff
  // PATCH /loads/:loadId/status endpoint uses — driverOwnerId makes it 404 instead of updating a
  // load that isn't this driver's.
  updateMyLoadStatus = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.updateStatus(
      req.driver!.tenantId,
      req.driver!.id,
      req.params.loadId,
      (req.body as UpdateLoadStatusInput).toStatus,
      req.driver!.id,
    );
    respond(res, load);
  };

  // Same LoadService.uploadPod the staff PATCH /loads/:loadId/pod endpoint uses. actorRole is a
  // literal here (a driver token carries no role) — LoadService only branches on it when tenantId
  // is falsy, which is never true for a driver-scoped call.
  uploadMyPod = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.uploadPod(
      req.driver!.tenantId,
      req.driver!.id,
      'driver',
      req.params.loadId,
      req.body as UploadPodInput,
      req.driver!.id,
    );
    respond(res, load);
  };

  // Step 1 of the driver's own POD upload — same shape and same StorageService.generateUploadUrl
  // as POST /v1/files (staff-only, unreachable by a driver token since it sits behind
  // authMiddleware); driver-portal.validators.ts pins `purpose` to the literal 'trips/pod' so a
  // driver can never request an upload URL for any other storage purpose.
  requestPodUploadUrl = async (req: Request, res: Response) => {
    const file = await this.storageService.generateUploadUrl(
      req.driver!.tenantId,
      req.driver!.id,
      req.body as GenerateUploadUrlInput,
    );
    respond(res, file, 201);
  };

  // Step 2 — confirms the direct-to-S3 upload from step 1. The resulting key is what gets passed
  // as podFileKey to uploadMyPod above.
  confirmPodUpload = async (req: Request, res: Response) => {
    const file = await this.storageService.confirmUpload(
      req.driver!.tenantId,
      (req.params as unknown as FileParams).fileId,
    );
    respond(res, file);
  };
}
