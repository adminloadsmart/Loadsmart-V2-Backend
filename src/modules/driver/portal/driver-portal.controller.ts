import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { PaginationInput } from '../../../shared/utils/pagination';
import { DriverService } from '../driver.service';
import { LoadService } from '../../loads/load.service';
import {
  ConfirmLoadingInput,
  ListLoadsInput,
  LoadParams,
  UpdateLoadStatusInput,
  UploadPodInput,
} from '../../loads/utils/load.interface';
import { ReportLoadIssueInput } from '../../loads/utils/load-issue.interface';
import { StorageService } from '../../storage/storage.service';
import { FileParams, GenerateUploadUrlInput } from '../../storage/storage.types';
import { ListNotificationsInput } from '../../notifications/notifications.interface';
import { DriverPortalService } from './driver-portal.service';
import { DriverNotificationCategory } from './driver-portal.types';

/**
 * The driver-app self-service layer — "do some stuff as myself". Every method is implicitly
 * scoped to req.driver!.id/req.driver!.tenantId (set by createDriverAuth), never a
 * client-supplied id, so there is no IDOR surface to review here by construction. Purely a thin
 * HTTP layer: request data in, one call out, respond(). Every "tenant or not" branch and every
 * cross-service aggregation lives in DriverPortalService instead — see that file. The handful of
 * methods below that call driverService/loadService/storageService directly (updateMyStatus,
 * getMyLoad, updateMyLoadStatus, uploadMyPod, reportMyIssue, requestUploadUrl, confirmUpload,
 * getMyTripDetail) are genuinely tenant-required actions with no "or global"/"or empty" branching
 * to extract — a straight service call is not business logic, just wiring.
 *
 * getMyLoad/updateMyLoadStatus/uploadMyPod/reportMyIssue are the exception to "implicitly
 * scoped" above — :loadId is client-supplied, so ownership (the load must actually be this
 * driver's own) is enforced inside LoadService via the driverOwnerId param, not here.
 */
export class DriverPortalController {
  constructor(
    private readonly driverPortalService: DriverPortalService,
    private readonly driverService: DriverService,
    private readonly loadService: LoadService,
    private readonly storageService: StorageService,
  ) {}

  getMe = async (req: Request, res: Response) => {
    const profile = await this.driverPortalService.getMyProfile(
      req.driver!.id,
      req.driver!.tenantId ?? null,
    );
    respond(res, profile);
  };

  getMyStatus = async (req: Request, res: Response) => {
    const status = await this.driverPortalService.getMyStatus(
      req.driver!.id,
      req.driver!.tenantId ?? null,
    );
    respond(res, status);
  };

  // actorId === driverId here — the driver is setting their own status, same
  // DriverService.setOperationalStatus code path staff already use (driver.controller.ts), just
  // invoked by the driver themselves. Genuinely tenant-required (there's no "set my status" with
  // no tenant to set it for), so this stays a direct call rather than routing through
  // DriverPortalService's "or empty" branching.
  updateMyStatus = async (req: Request, res: Response) => {
    const status = await this.driverService.setOperationalStatus(
      req.driver!.tenantId!,
      req.driver!.id,
      req.driver!.id,
      req.body,
    );
    respond(res, status);
  };

  verifyMyBankAccount = async (req: Request, res: Response) => {
    const result = await this.driverPortalService.checkMyBankAccount(
      req.body.accountNumber,
      req.body.ifsc,
    );
    respond(res, result);
  };

  addMyBankDetails = async (req: Request, res: Response) => {
    const bankDetails = await this.driverPortalService.addMyBankDetails(req.driver!.id, req.body);
    respond(res, bankDetails, 201);
  };

  listMyBankDetails = async (req: Request, res: Response) => {
    respond(res, await this.driverPortalService.listMyBankDetails(req.driver!.id));
  };

  getMyTripMetrics = async (req: Request, res: Response) => {
    const metrics = await this.driverPortalService.getMyTripMetrics(
      req.driver!.id,
      req.driver!.tenantId ?? null,
    );
    respond(res, metrics);
  };

  getMyLoads = async (req: Request, res: Response) => {
    const loads = await this.driverPortalService.getMyLoads(
      req.driver!.id,
      req.driver!.tenantId ?? null,
      req.validatedQuery as ListLoadsInput,
      req.locale,
    );
    respond(res, loads);
  };

  getMyTripsDone = async (req: Request, res: Response) => {
    const trips = await this.driverPortalService.getMyTripsDone(
      req.driver!.id,
      req.driver!.tenantId ?? null,
      req.validatedQuery as PaginationInput,
      req.locale,
    );
    respond(res, trips);
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
      req.locale,
    );
    respond(res, result);
  };

  // Driver-app "Trip Done" detail screen — a lean single-pickup/single-drop summary, distinct
  // from getMyLoad above. Same ownership-check-as-404 convention.
  getMyTripDetail = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.loadService.getMyTripDetail(
      req.driver!.tenantId!,
      req.driver!.id,
      req.params.loadId,
    );
    respond(res, result);
  };

  // Driver-app "Show papers" screen — E-way bill / LR / Invoice for a load assigned to the
  // caller. Same ownership-check-as-404 convention as getMyTripDetail above.
  getLoadDocuments = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.loadService.getLoadDocuments(
      req.driver!.tenantId!,
      req.driver!.id,
      req.params.loadId,
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

  // Same LoadService.confirmLoading the staff PATCH /loads/:loadId/confirm-loading endpoint uses —
  // mandatory invoice/e-way-bill/E-LR (skippable per-document once already on the load) plus the
  // non-mandatory loading photos/weighing slip. Same ownership-check-as-404/actorRole-literal
  // convention as uploadMyPod below.
  confirmMyLoading = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.confirmLoading(
      req.driver!.tenantId!,
      req.driver!.id,
      'driver',
      req.params.loadId,
      req.body as ConfirmLoadingInput,
      req.driver!.id,
    );
    respond(res, load);
  };

  // Plain document attach/replace — no status-transition semantics, usable any time before
  // closed (e.g. to fix a document after loading was already confirmed). See
  // LoadService.updateDocuments.
  updateMyDocuments = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.updateDocuments(
      req.driver!.tenantId!,
      req.driver!.id,
      'driver',
      req.params.loadId,
      req.body as ConfirmLoadingInput,
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

  // Step 1 of the delivery flow — texts the receiver a 4-digit code; verified at uploadMyPod.
  sendMyPodReceiverCode = async (req: Request<LoadParams>, res: Response) => {
    await this.loadService.sendPodReceiverCode(
      req.driver!.tenantId!,
      req.params.loadId,
      req.body.mobile,
      req.driver!.id,
    );
    respond(res, { sent: true });
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

  // --- Notifications — see driver-portal.service.ts's driver-facing methods. Not tenant-scoped:
  // a driver's inbox spans every tenant relation they've ever had, so these work the same whether
  // or not req.driver!.tenantId is set. ---

  getMyNotifications = async (req: Request, res: Response) => {
    const { category, ...query } = req.validatedQuery as ListNotificationsInput & {
      category?: DriverNotificationCategory;
    };
    const notifications = await this.driverPortalService.getMyNotifications(
      req.driver!.id,
      category,
      query,
    );
    respond(res, notifications);
  };

  markMyNotificationRead = async (req: Request, res: Response) => {
    const notification = await this.driverPortalService.markMyNotificationRead(
      req.driver!.id,
      String((req.params as { notificationId: string }).notificationId),
    );
    respond(res, notification);
  };

  markAllMyNotificationsRead = async (req: Request, res: Response) => {
    const result = await this.driverPortalService.markAllMyNotificationsRead(req.driver!.id);
    respond(res, result);
  };

  // Home screen — see driver-portal.service.ts's getMyHome for what this bundles and why.
  getMyHome = async (req: Request, res: Response) => {
    const home = await this.driverPortalService.getMyHome(
      req.driver!.id,
      req.driver!.tenantId ?? null,
    );
    respond(res, home);
  };
}
