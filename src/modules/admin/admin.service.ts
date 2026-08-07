import { OrganizationService } from '../auth/organization.service';
import { OrganizationDocumentService } from '../auth/organization-document.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService, resolveReferralCodeStatus } from '../auth/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { ConflictError, rethrow, ValidationError } from '../../shared/errors';
import {
  ONLINE_KYC_DESK_ROLE,
  OFFLINE_KYC_DESK_ROLE,
  SALES_ROLE,
} from '../../shared/constants/roles';
import { paginate } from './utils/admin.types';
import {
  AssignReviewerInput,
  CreateReferralCodeInput,
  ListOrganizationsInput,
  ListReferralCodesInput,
  ListStaffInput,
  OrganizationDecisionReasonInput,
  UpdateOrganizationInput,
  UpdateReferralCodeInput,
  VerifyOrganizationDocumentInput,
} from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';

export class AdminService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly authService: AuthService,
    private readonly referralCodeService: ReferralCodeService,
    private readonly auditService: AuditService,
  ) {}

  async listOrganizations(input: ListOrganizationsInput) {
    const { items, total } = await this.organizationService.listOrganizations(input);
    return paginate(items, total, input);
  }

  async getOrganization(organizationId: string) {
    try {
      const [organization, documents] = await Promise.all([
        this.organizationService.getOrganizationStatus(organizationId),
        this.organizationDocumentService.listByOrganization(organizationId),
      ]);
      return { ...organization, documents };
    } catch (error) {
      rethrow(error, 'Failed to get organization');
    }
  }

  async updateOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: UpdateOrganizationInput,
  ) {
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
      newData: {
        documentId,
        documentType: document.documentType,
        verificationStatus: document.verificationStatus,
      },
    });

    return document;
  }

  /** Assignment is record-keeping/routing only today — /admin/* stays platform_admin-only, "no
   *  exceptions" (see admin.routes.ts), so this doesn't grant the assignee themselves any access.
   *  Shared logic between the two roles, factored out below as assignReviewer. */
  assignOnlineVerifier(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: AssignReviewerInput,
  ) {
    return this.assignReviewer(actingUser, organizationId, input.userId, {
      role: ONLINE_KYC_DESK_ROLE,
      field: 'onlineKycVerifierId',
      action: 'ONLINE_KYC_VERIFIER_ASSIGNED',
    });
  }

  assignPhysicalAgent(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: AssignReviewerInput,
  ) {
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

    const organization = await this.organizationService.updateOrganization(organizationId, {
      [opts.field]: userId,
    });

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
      throw new ValidationError('Cannot approve: every submitted document must be verified first', {
        unverifiedDocumentIds: unverified.map((document) => document.id),
      });
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

  rejectOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: OrganizationDecisionReasonInput,
  ) {
    return this.decideOrganization(
      actingUser,
      organizationId,
      input.reason,
      'ORGANIZATION_REJECTED',
    );
  }

  denyOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: OrganizationDecisionReasonInput,
  ) {
    return this.decideOrganization(actingUser, organizationId, input.reason, 'ORGANIZATION_DENIED');
  }

  /** Reject and Deny both land on status: 'rejected' — the existing OrganizationStatus enum has no
   *  separate value for each — distinguished by which audit action fired and by decisionReason's
   *  text, not by a different status. */
  private async decideOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    reason: string,
    action: string,
  ) {
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

  async getOrganizationAuditTrail(
    organizationId: string,
    pagination: { page: number; limit: number },
  ) {
    const { items, total } = await this.auditService.findByOrganization(organizationId, pagination);
    return paginate(items, total, pagination);
  }

  createStaff(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    return this.authService.createStaffUser(actingUser, input);
  }

  listStaff(input: ListStaffInput) {
    return this.authService.listStaffUsers(input);
  }

  /** Mirrors assignReviewer's role-check pattern above: the owner must actually hold the 'sales'
   *  role, checked here (not at the schema level, same reasoning as assignReviewer). */
  async createReferralCode(actingUser: AuthenticatedUser, input: CreateReferralCodeInput) {
    const owner = await this.authService.getUserById(input.ownerUserId);
    if (owner.role.name !== SALES_ROLE) {
      throw new ValidationError(`User ${input.ownerUserId} does not have the "${SALES_ROLE}" role`);
    }

    const referralCode = await this.referralCodeService.createCode({
      code: input.code,
      ownerUserId: input.ownerUserId,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      createdBy: actingUser.id,
    });

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'REFERRAL_CODE_CREATED',
      resourceType: 'referral_code',
      newData: {
        id: referralCode.id,
        code: referralCode.code,
        ownerUserId: referralCode.ownerUserId,
        validFrom: referralCode.validFrom,
        validUntil: referralCode.validUntil,
      },
    });

    return referralCode;
  }

  async listReferralCodes(input: ListReferralCodesInput) {
    const { items, total } = await this.referralCodeService.list(input);
    return paginate(items, total, input);
  }

  async getReferralCode(referralCodeId: string) {
    const referralCode = await this.referralCodeService.getById(referralCodeId);
    return { ...referralCode, status: resolveReferralCodeStatus(referralCode) };
  }

  /** Owner reassignment (if any) is re-checked against the 'sales' role the same way
   *  createReferralCode checks it — a partial body that only touches validFrom/validUntil skips
   *  this check entirely. */
  async updateReferralCode(
    actingUser: AuthenticatedUser,
    referralCodeId: string,
    input: UpdateReferralCodeInput,
  ) {
    const before = await this.referralCodeService.getById(referralCodeId);

    if (input.ownerUserId) {
      const owner = await this.authService.getUserById(input.ownerUserId);
      if (owner.role.name !== SALES_ROLE) {
        throw new ValidationError(
          `User ${input.ownerUserId} does not have the "${SALES_ROLE}" role`,
        );
      }
    }

    const updated = await this.referralCodeService.update(referralCodeId, input);

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'REFERRAL_CODE_UPDATED',
      resourceType: 'referral_code',
      oldData: {
        ownerUserId: before.ownerUserId,
        validFrom: before.validFrom,
        validUntil: before.validUntil,
      },
      newData: {
        ownerUserId: updated.ownerUserId,
        validFrom: updated.validFrom,
        validUntil: updated.validUntil,
      },
    });

    return updated;
  }

  async revokeReferralCode(actingUser: AuthenticatedUser, referralCodeId: string) {
    const before = await this.referralCodeService.getById(referralCodeId);
    const after = await this.referralCodeService.revoke(referralCodeId);

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'REFERRAL_CODE_REVOKED',
      resourceType: 'referral_code',
      oldData: { revokedAt: before.revokedAt },
      newData: { revokedAt: after.revokedAt },
    });

    return after;
  }

  /** Hard delete — only allowed while the code has never been redeemed by an organization (see
   *  OrganizationService.countByReferralCodeId). Once it has, the row has to stay for
   *  attribution/audit history — POST .../revoke is the only option at that point. */
  async deleteReferralCode(actingUser: AuthenticatedUser, referralCodeId: string) {
    const before = await this.referralCodeService.getById(referralCodeId);

    const usageCount = await this.organizationService.countByReferralCodeId(referralCodeId);
    if (usageCount > 0) {
      throw new ConflictError(
        `Referral code has been used by ${usageCount} organization(s) and cannot be deleted — revoke it instead`,
      );
    }

    await this.referralCodeService.delete(referralCodeId);

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'REFERRAL_CODE_DELETED',
      resourceType: 'referral_code',
      oldData: { id: before.id, code: before.code, ownerUserId: before.ownerUserId },
    });
  }
}
