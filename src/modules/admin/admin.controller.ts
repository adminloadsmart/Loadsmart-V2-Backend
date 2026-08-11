import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import {
  AssignReviewerInput,
  CreateReferralCodeInput,
  ListOrganizationsInput,
  ListReferralCodesInput,
  ListStaffInput,
  OrganizationDecisionReasonInput,
  OrganizationDocumentParams,
  OrganizationParams,
  ReferralCodeParams,
  UpdateOrganizationInput,
  UpdateReferralCodeInput,
  VerifyOrganizationDocumentInput,
} from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';
import { AdminService } from './admin.service';

export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  listOrganizations = async (req: Request, res: Response) => {
    const organizations = await this.adminService.listOrganizations(
      req.user!,
      req.validatedQuery as ListOrganizationsInput,
    );
    respond(res, organizations);
  };

  getOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.getOrganization(
      req.user!,
      req.params.organizationId,
    );
    respond(res, organization);
  };

  updateOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.updateOrganization(
      req.user!,
      req.params.organizationId,
      req.body as UpdateOrganizationInput,
    );
    respond(res, organization);
  };

  verifyOrganizationDocument = async (req: Request<OrganizationDocumentParams>, res: Response) => {
    const document = await this.adminService.verifyOrganizationDocument(
      req.user!,
      req.params.organizationId,
      req.params.documentId,
      req.body as VerifyOrganizationDocumentInput,
    );
    respond(res, document);
  };

  assignOnlineVerifier = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.assignOnlineVerifier(
      req.user!,
      req.params.organizationId,
      req.body as AssignReviewerInput,
    );
    respond(res, organization);
  };

  assignPhysicalAgent = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.assignPhysicalAgent(
      req.user!,
      req.params.organizationId,
      req.body as AssignReviewerInput,
    );
    respond(res, organization);
  };

  completeOnlineKyc = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.completeOnlineKyc(
      req.user!,
      req.params.organizationId,
    );
    respond(res, organization);
  };

  approvePhysicalKyc = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.approvePhysicalKyc(
      req.user!,
      req.params.organizationId,
    );
    respond(res, organization);
  };

  approveOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.approveOrganization(
      req.user!,
      req.params.organizationId,
    );
    respond(res, organization);
  };

  rejectOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.rejectOrganization(
      req.user!,
      req.params.organizationId,
      req.body as OrganizationDecisionReasonInput,
    );
    respond(res, organization);
  };

  denyOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.denyOrganization(
      req.user!,
      req.params.organizationId,
      req.body as OrganizationDecisionReasonInput,
    );
    respond(res, organization);
  };

  getOrganizationAuditTrail = async (req: Request<OrganizationParams>, res: Response) => {
    const trail = await this.adminService.getOrganizationAuditTrail(
      req.user!,
      req.params.organizationId,
      req.validatedQuery as { page: number; limit: number },
    );
    respond(res, trail);
  };

  createStaff = async (req: Request, res: Response) => {
    const staff = await this.adminService.createStaff(req.user!, req.body as CreateStaffInput);
    respond(res, staff, 201);
  };

  listStaff = async (req: Request, res: Response) => {
    const staff = await this.adminService.listStaff(req.validatedQuery as ListStaffInput);
    respond(res, staff);
  };

  createReferralCode = async (req: Request, res: Response) => {
    const referralCode = await this.adminService.createReferralCode(
      req.user!,
      req.body as CreateReferralCodeInput,
    );
    respond(res, referralCode, 201);
  };

  listReferralCodes = async (req: Request, res: Response) => {
    const referralCodes = await this.adminService.listReferralCodes(
      req.validatedQuery as ListReferralCodesInput,
    );
    respond(res, referralCodes);
  };

  getReferralCode = async (req: Request<ReferralCodeParams>, res: Response) => {
    const referralCode = await this.adminService.getReferralCode(req.params.referralCodeId);
    respond(res, referralCode);
  };

  updateReferralCode = async (req: Request<ReferralCodeParams>, res: Response) => {
    const referralCode = await this.adminService.updateReferralCode(
      req.user!,
      req.params.referralCodeId,
      req.body as UpdateReferralCodeInput,
    );
    respond(res, referralCode);
  };

  revokeReferralCode = async (req: Request<ReferralCodeParams>, res: Response) => {
    const referralCode = await this.adminService.revokeReferralCode(
      req.user!,
      req.params.referralCodeId,
    );
    respond(res, referralCode);
  };

  deleteReferralCode = async (req: Request<ReferralCodeParams>, res: Response) => {
    await this.adminService.deleteReferralCode(req.user!, req.params.referralCodeId);
    respond(res, { success: true });
  };
}
