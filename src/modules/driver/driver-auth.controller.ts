import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { DriverAuthService } from './driver-auth.service';
import { DriverIdentityService } from './driver-identity.service';
import { OrganizationService } from '../organization/organization.service';
import { StorageService } from '../storage/storage.service';
import { GenerateUploadUrlInput, FileParams } from '../storage/storage.types';
import { DriverRelationParams } from './drivers.interface';

// Mirrors modules/auth/auth.controller.ts's shape — see docs/driver-auth.md for why this is a
// separate identity domain rather than another endpoint on AuthController. Also owns
// self-registration (requestRegisterOtp/verifyRegisterOtp/register) and cross-tenant relation
// management (listMyRelations/requestJoin/acceptInvite/rejectInvite/searchOrganizations) — login,
// registration, and relation management are all entry points into the same driver identity
// domain, so they share this controller/router rather than living in separate modules; the
// business logic itself still lives on DriverAuthService/DriverIdentityService, not here.
export class DriverAuthController {
  constructor(
    private readonly driverAuthService: DriverAuthService,
    private readonly driverIdentityService: DriverIdentityService,
    private readonly organizationService: OrganizationService,
    private readonly storageService: StorageService,
  ) {}

  // --- Login ---

  requestOtp = async (req: Request, res: Response) => {
    const result = await this.driverAuthService.requestOtp(req.body);
    respond(res, result, 200);
  };

  verifyOtp = async (req: Request, res: Response) => {
    const { phoneNumber, driverId } = req.driverLoginPayload!;
    const result = await this.driverAuthService.verifyOtp({
      phoneNumber,
      driverId,
      otp: req.body.otp,
      fcmToken: req.body.fcmToken,
      deviceType: req.body.deviceType,
      deviceInfo: req.body.deviceInfo,
      ipAddress: req.ip ?? null,
    });
    respond(res, result);
  };

  selectTenant = async (req: Request, res: Response) => {
    const { driverId, candidates } = req.driverTenantSelectPayload!;
    const result = await this.driverAuthService.selectTenant({
      driverId,
      candidates,
      tenantId: req.body.tenantId,
      fcmToken: req.body.fcmToken,
      deviceType: req.body.deviceType,
      deviceInfo: req.body.deviceInfo,
      ipAddress: req.ip ?? null,
    });
    respond(res, result);
  };

  // Lets an already-authenticated driver switch active tenant context mid-session (e.g. right
  // after accepting an invite) without repeating the OTP dance — accepts either an
  // identity-scoped or tenant-scoped token, see createDriverAuth's requireTenant: false wiring.
  selectRelation = async (req: Request, res: Response) => {
    const result = await this.driverAuthService.selectRelation({
      driverId: req.driver!.id,
      relationId: req.body.relationId,
      device: {
        fcmToken: req.body.fcmToken,
        deviceType: req.body.deviceType,
        deviceInfo: req.body.deviceInfo,
        ipAddress: req.ip ?? null,
      },
    });
    respond(res, result);
  };

  refresh = async (req: Request, res: Response) => {
    const result = await this.driverAuthService.refresh(req.body);
    respond(res, result);
  };

  // No body needed — sid/jti/exp all come from the caller's own verified driver access token.
  logout = async (req: Request, res: Response) => {
    await this.driverAuthService.logout({
      sid: req.driver!.sid,
      jti: req.driver!.jti,
      exp: req.driver!.exp,
    });
    respond(res, { success: true });
  };

  updateDeviceToken = async (req: Request, res: Response) => {
    await this.driverAuthService.updateDeviceToken(
      req.driver!.sid!,
      req.body.fcmToken,
      req.body.deviceType,
    );
    respond(res, { success: true });
  };

  // --- Self-registration ---
  // Mirrors the login OTP handshake shape above, but for "this phone has no driver profile yet"
  // rather than login's "this phone must already be registered". See driver-identity.service.ts.

  requestRegisterOtp = async (req: Request, res: Response) => {
    const result = await this.driverIdentityService.requestOtp(req.body.phoneNumber);
    respond(res, result, 200);
  };

  // Creates the driver profile and issues a real session — see driver-identity.service.ts's
  // verifyOtp for why this happens here rather than at the end of the form.
  verifyRegisterOtp = async (req: Request, res: Response) => {
    const { phoneNumber } = req.driverRegisterOtpPayload!;
    const result = await this.driverIdentityService.verifyOtp(phoneNumber, req.body.otp, {
      fcmToken: req.body.fcmToken,
      deviceType: req.body.deviceType,
      deviceInfo: req.body.deviceInfo,
      ipAddress: req.ip ?? null,
    });
    respond(res, result, 201);
  };

  // Authenticated (identity or tenant-scoped token) — completes/updates the caller's own
  // registration details. Callable again to resume after an incomplete first attempt.
  register = async (req: Request, res: Response) => {
    const result = await this.driverIdentityService.completeRegistration(req.driver!.id, req.body);
    respond(res, result);
  };

  // Step-1 preflight, mirroring POST /masters/drivers/verify-dl — lets the app show the Sarathi
  // verification outcome on screen 1 before the driver submits the rest of the form. Read-only,
  // no driverId param needed since it never touches the driver row (see
  // DriverIdentityService.checkDrivingLicence).
  verifyDl = async (req: Request, res: Response) => {
    const result = await this.driverIdentityService.checkDrivingLicence(
      req.body.licenseNumber,
      req.body.dateOfBirth,
    );
    respond(res, result);
  };

  // Upload handshake for a self-registering driver's own DL photos, before they've linked to any
  // tenant — a tenant-less mirror of driver-portal.controller.ts's requestUploadUrl/confirmUpload
  // (which require a tenant-scoped driver-access token this caller doesn't have yet). Restricted
  // to purpose `masters/driver` only — see driver-auth.validators.ts.
  requestUploadUrl = async (req: Request, res: Response) => {
    const file = await this.storageService.generateUploadUrl(
      null,
      req.driver!.id,
      req.body as GenerateUploadUrlInput,
    );
    respond(res, file, 201);
  };

  // Step 2 — confirms the direct-to-S3 upload from step 1. The resulting key is what gets passed
  // as documents[].fileUrl to POST /register.
  confirmUpload = async (req: Request, res: Response) => {
    const file = await this.storageService.confirmUpload(
      null,
      (req.params as unknown as FileParams).fileId,
    );
    respond(res, file);
  };

  // --- Cross-tenant relation management ---
  // A driver acting on their own relations across every tenant they're linked to, not scoped to
  // one tenant — see createDriverAuth's requireTenant: false wiring in index.ts.

  listMyRelations = async (req: Request, res: Response) => {
    const relations = await this.driverIdentityService.listMyRelations(req.driver!.id);
    respond(res, relations);
  };

  requestJoin = async (req: Request, res: Response) => {
    const result = await this.driverIdentityService.requestJoin(req.driver!.id, req.body);
    respond(res, result, 201);
  };

  acceptInvite = async (req: Request<DriverRelationParams>, res: Response) => {
    const result = await this.driverIdentityService.respondToInvite(
      req.driver!.id,
      req.params.relationId,
      { accept: true },
    );
    respond(res, result);
  };

  rejectInvite = async (req: Request<DriverRelationParams>, res: Response) => {
    const result = await this.driverIdentityService.respondToInvite(
      req.driver!.id,
      req.params.relationId,
      { accept: false, reason: req.body.reason },
    );
    respond(res, result);
  };

  // Join-request target search — name + id only, no sensitive fields, restricted to fully active
  // orgs, matched by org name or a staff member's phone number (see
  // OrganizationRepository.searchActiveByNameOrPhone).
  searchOrganizations = async (req: Request, res: Response) => {
    const { q } = req.validatedQuery as { q: string };
    const results = await this.organizationService.searchActiveByNameOrPhone(q);
    respond(res, results);
  };
}
