import { OrganizationService } from '../auth/organization.service';
import { OrganizationDocumentService } from '../auth/organization-document.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { ValidationError } from '../../shared/errors';
import { ONLINE_KYC_DESK_ROLE, OFFLINE_KYC_DESK_ROLE } from '../../shared/constants/roles';
import { paginate } from './utils/admin.types';
import {
  AssignReviewerInput,
  ListOrganizationsInput,
  ListStaffInput,
  OrganizationDecisionReasonInput,
  UpdateOrganizationInput,
  VerifyOrganizationDocumentInput,
} from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';

export class AdminService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) { }

  async listOrganizations(input: ListOrganizationsInput) {
    const { items, total } = await this.organizationService.listOrganizations(input);
    return paginate(items, total, input);
  }

  async getOrganization(organizationId: string) {
    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(organizationId),
      this.organizationDocumentService.listByOrganization(organizationId),
    ]);
    return { ...organization, documents };
  }

  async updateOrganization(actingUser: AuthenticatedUser, organizationId: string, input: UpdateOrganizationInput) {
    const before = await this.organizationService.getOrganizationStatus(organizationId);
    const organization = await this.organizationService.updateOrganization(organizationId, input);

    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUser.id,
      action: 'ORGANIZATION_STATUS_UPDATED',
      resourceType: 'organization',
      oldData: { status: before.status },
      newData: { status: organization.status },
    });

    return organization;
  }

  async verifyOrganizationDocument(
    actingUser: AuthenticatedUser,
    organizationId: string,
    documentId: string,
    input: VerifyOrganizationDocumentInput,
  ) {
    const document = await this.organizationDocumentService.updateVerificationStatus(
      organizationId,
      documentId,
      actingUser.id,
      input,
    );

    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUser.id,
      action: 'ORGANIZATION_DOCUMENT_VERIFIED',
      resourceType: 'organization_document',
      newData: { documentId, documentType: document.documentType, verificationStatus: document.verificationStatus },
    });

    return document;
  }

  /** Assignment is record-keeping/routing only today — /admin/* stays platform_admin-only, "no
   *  exceptions" (see admin.routes.ts), so this doesn't grant the assignee themselves any access.
   *  Shared logic between the two roles, factored out below as assignReviewer. */
  assignOnlineVerifier(actingUser: AuthenticatedUser, organizationId: string, input: AssignReviewerInput) {
    return this.assignReviewer(actingUser, organizationId, input.userId, {
      role: ONLINE_KYC_DESK_ROLE,
      field: 'onlineKycVerifierId',
      action: 'ONLINE_KYC_VERIFIER_ASSIGNED',
    });
  }

  assignPhysicalAgent(actingUser: AuthenticatedUser, organizationId: string, input: AssignReviewerInput) {
    return this.assignReviewer(actingUser, organizationId, input.userId, {
      role: OFFLINE_KYC_DESK_ROLE,
      field: 'physicalKycAgentId',
      action: 'PHYSICAL_KYC_AGENT_ASSIGNED',
    });
  }

  private async assignReviewer(
    actingUser: AuthenticatedUser,
    organizationId: string,
    userId: string,
    opts: { role: string; field: 'onlineKycVerifierId' | 'physicalKycAgentId'; action: string },
  ) {
    const target = await this.authService.getUserById(userId);
    if (target.role.name !== opts.role) {
      throw new ValidationError(`User ${userId} does not have the "${opts.role}" role`);
    }

    const organization = await this.organizationService.updateOrganization(organizationId, { [opts.field]: userId });

    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUser.id,
      action: opts.action,
      resourceType: 'organization',
      newData: { [opts.field]: userId },
    });

    return organization;
  }

  /** Unlocks only once every submitted document is verified — mirrors the review screen's "docs ✓"
   *  gate. (There's no physical-KYC-completion concept yet, so that half of the mockup's gate isn't
   *  enforced here — see the plan this was built from.) */
  async approveOrganization(actingUser: AuthenticatedUser, organizationId: string) {
    const documents = await this.organizationDocumentService.listByOrganization(organizationId);
    const unverified = documents.filter((document) => document.verificationStatus !== 'verified');
    if (documents.length === 0 || unverified.length > 0) {
      throw new ValidationError(
        'Cannot approve: every submitted document must be verified first',
        { unverifiedDocumentIds: unverified.map((document) => document.id) },
      );
    }

    const organization = await this.organizationService.updateOrganization(organizationId, {
      status: 'active',
      decisionReason: null,
    });

    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUser.id,
      action: 'ORGANIZATION_APPROVED',
      resourceType: 'organization',
      newData: { status: 'active' },
    });

    return organization;
  }

  rejectOrganization(actingUser: AuthenticatedUser, organizationId: string, input: OrganizationDecisionReasonInput) {
    return this.decideOrganization(actingUser, organizationId, input.reason, 'ORGANIZATION_REJECTED');
  }

  denyOrganization(actingUser: AuthenticatedUser, organizationId: string, input: OrganizationDecisionReasonInput) {
    return this.decideOrganization(actingUser, organizationId, input.reason, 'ORGANIZATION_DENIED');
  }

  /** Reject and Deny both land on status: 'rejected' — the existing OrganizationStatus enum has no
   *  separate value for each — distinguished by which audit action fired and by decisionReason's
   *  text, not by a different status. */
  private async decideOrganization(actingUser: AuthenticatedUser, organizationId: string, reason: string, action: string) {
    const organization = await this.organizationService.updateOrganization(organizationId, {
      status: 'rejected',
      decisionReason: reason,
    });

    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUser.id,
      action,
      resourceType: 'organization',
      newData: { status: 'rejected', reason },
    });

    return organization;
  }

  async getOrganizationAuditTrail(organizationId: string, pagination: { page: number; limit: number }) {
    const { items, total } = await this.auditService.findByOrganization(organizationId, pagination);
    return paginate(items, total, pagination);
  }

  createStaff(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    return this.authService.createStaffUser(actingUser, input);
  }

  listStaff(input: ListStaffInput) {
    return this.authService.listStaffUsers(input);
  }
}
