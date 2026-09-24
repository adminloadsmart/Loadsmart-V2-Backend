import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { paginate } from '../../shared/utils/pagination';
import { DriverService } from './driver.service';
import { LoadService } from '../loads/load.service';
import {
  ListLoadsInput,
  LoadParams,
  UpdateLoadStatusInput,
  UploadPodInput,
} from '../loads/utils/load.interface';
import { ReportLoadIssueInput } from '../loads/utils/load-issue.interface';
import { StorageService } from '../storage/storage.service';
import { FileParams, GenerateUploadUrlInput } from '../storage/storage.types';

/**
 * The driver-app self-service layer — "do some stuff as myself". Every method is implicitly
 * scoped to req.driver!.id/req.driver!.tenantId (set by createDriverAuth), never a
 * client-supplied id, so there is no IDOR surface to review here by construction. Calls straight
 * into the same DriverService/LoadService the staff-facing masters/loads routes use — no
 * duplicated queries, no repository of its own. See docs/driver-auth.md.
 *
 * getMyLoad/updateMyLoadStatus/uploadMyPod/reportMyIssue are the exception to "implicitly
 * scoped" above — :loadId is client-supplied, so ownership (the load must actually be this
 * driver's own) is enforced inside LoadService via the driverOwnerId param, not here.
 */
export class DriverPortalController {
  constructor(
    private readonly driverService: DriverService,
    private readonly loadService: LoadService,
    private readonly storageService: StorageService,
  ) {}

  // Profile screen. A driver not yet linked to any tenant (no active relation, so no tenantId on
  // their token) still gets their own global profile back — see getMyGlobalProfile. Once linked,
  // this becomes the full aggregated view (driver + assigned vehicle's compliance dates +
  // trip-metric performance + org name); see DriverProfileView's doc comment for which fields are
  // real data vs. explicit null (nothing server-side tracks them yet).
  getMe = async (req: Request, res: Response) => {
    const profile = req.driver!.tenantId
      ? await this.driverService.getMyProfile(req.driver!.tenantId, req.driver!.id)
      : await this.driverService.getMyGlobalProfile(req.driver!.id);
    respond(res, profile);
  };

  // A driver with no active tenant relation has no operational status anywhere — null, not a
  // permissions error.
  getMyStatus = async (req: Request, res: Response) => {
    if (!req.driver!.tenantId) {
      respond(res, null);
      return;
    }
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
      req.driver!.tenantId!,
      req.driver!.id,
      req.driver!.id,
      req.body,
    );
    respond(res, status);
  };

  // Read-only — trip metrics read as ops-computed KPIs (see driver.service.ts's
  // recordTripMetrics, staff-only), not driver-self-reported data. No tenant relation means no
  // metrics anywhere — empty array, not a permissions error.
  getMyTripMetrics = async (req: Request, res: Response) => {
    if (!req.driver!.tenantId) {
      respond(res, []);
      return;
    }
    const metrics = await this.driverService.listTripMetrics(req.driver!.tenantId, req.driver!.id);
    respond(res, metrics);
  };

  // No tenant relation means this driver cannot be assigned to any load in any tenant — an empty
  // page, not a permissions error, same reasoning as getMyStatus/getMyTripMetrics above.
  getMyLoads = async (req: Request, res: Response) => {
    const query = req.validatedQuery as ListLoadsInput;
    if (!req.driver!.tenantId) {
      respond(res, paginate([], 0, query));
      return;
    }
    const loads = await this.loadService.list(req.driver!.tenantId, {
      ...query,
      driverId: req.driver!.id,
    });
    respond(res, loads);
  };

  // Single-load detail — same LoadService.get the staff GET /loads/:loadId endpoint uses
  // (documents resolved to download URLs, activity timeline, progress stepper, next-action
  // panel), for a load assigned to the caller. driverOwnerId makes it 404 instead of returning a
  // load that isn't this driver's, same convention as updateMyLoadStatus/uploadMyPod below.
  getMyLoad = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.loadService.get(
      req.driver!.tenantId!,
      'driver',
      req.params.loadId,
      req.driver!.id,
    );
    respond(res, result);
  };

  // Manual tracking advance (at_plant -> in_transit -> reached_delivery_point) for a load this
  // driver is the assigned own-fleet driver of. Same LoadService.updateStatus the staff
  // PATCH /loads/:loadId/status endpoint uses — driverOwnerId makes it 404 instead of updating a
  // load that isn't this driver's.
  updateMyLoadStatus = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.updateStatus(
      req.driver!.tenantId!,
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
      req.driver!.tenantId!,
      req.driver!.id,
      'driver',
      req.params.loadId,
      req.body as UploadPodInput,
      req.driver!.id,
    );
    respond(res, load);
  };

  // Driver-app "Report An Issue" — a problem flagged on a load this driver is carrying (see
  // load.service.ts's reportIssue for the ownership-check/audit-FK reasoning, identical to
  // updateMyLoadStatus/uploadMyPod above). actorRole is a literal, same reasoning as uploadMyPod.
  reportMyIssue = async (req: Request<LoadParams>, res: Response) => {
    const issue = await this.loadService.reportIssue(
      req.driver!.tenantId!,
      req.driver!.id,
      'driver',
      req.params.loadId,
      req.body as ReportLoadIssueInput,
      req.driver!.id,
    );
    respond(res, issue, 201);
  };

  // Step 1 of the driver's own upload handshake — same shape and same
  // StorageService.generateUploadUrl as POST /v1/files (staff-only, unreachable by a driver token
  // since it sits behind authMiddleware); driver-portal.validators.ts restricts `purpose` to
  // trips/pod (E-POD photos) or loads/issue (issue-report photos) — the only two a driver may
  // request through this route.
  requestUploadUrl = async (req: Request, res: Response) => {
    const file = await this.storageService.generateUploadUrl(
      req.driver!.tenantId!,
      req.driver!.id,
      req.body as GenerateUploadUrlInput,
    );
    respond(res, file, 201);
  };

  // Step 2 — confirms the direct-to-S3 upload from step 1. The resulting key is what gets passed
  // as podFileKey to uploadMyPod, or as one of photoFileKeys to reportMyIssue, above.
  confirmUpload = async (req: Request, res: Response) => {
    const file = await this.storageService.confirmUpload(
      req.driver!.tenantId!,
      (req.params as unknown as FileParams).fileId,
    );
    respond(res, file);
  };
}
