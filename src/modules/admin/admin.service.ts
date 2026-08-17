import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import {
  OrganizationEntity,
  OrganizationJourneyStage,
} from '../organization/entities/organization.entity';
import { AuthService } from '../auth/auth.service';
import {
  ReferralCodeService,
  resolveReferralCodeStatus,
} from '../organization/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.types';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import {
  PLATFORM_ADMIN_ROLE,
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
  SetReferralCodeStatusInput,
  UpdateOrganizationInput,
  UpdateReferralCodeInput,
  VerifyOrganizationDocumentInput,
} from './utils/admin.interface';
import { CreateStaffInput, UpdateStaffInput } from '../auth/auth.types';

export class AdminService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly organizationJourneyStageService: OrganizationJourneyStageService,
    private readonly authService: AuthService,
    private readonly referralCodeService: ReferralCodeService,
    private readonly auditService: AuditService,
  ) {}

  /** platform_admin gets every org, unfiltered. online_kyc_desk/offline_kyc_desk only ever see
   *  their own assigned orgs — and offline_kyc_desk additionally only once handed over (see
   *  assertOrgAccessible's doc comment for the single-org equivalent of this same rule). */
  async listOrganizations(actingUser: AuthenticatedUser, input: ListOrganizationsInput) {
    try {
      const scoped = { ...input, ...this.reviewerScopeFilter(actingUser) };
      const { items, total } = await this.organizationService.listOrganizations(scoped);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list organizations');
    }
  }

  async getOrganization(actingUser: AuthenticatedUser, organizationId: string) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);

      const [documents, journeyStageHistory] = await Promise.all([
        this.organizationDocumentService.listByOrganization(organizationId),
        this.organizationJourneyStageService.getTrail(organizationId),
      ]);
      return { ...organization, documents, journeyStageHistory };
    } catch (error) {
      rethrow(error, 'Failed to get organization');
    }
  }

  private reviewerScopeFilter(actingUser: AuthenticatedUser): {
    onlineKycVerifierId?: string;
    physicalKycAgentId?: string;
    onlineKycCompleted?: boolean;
  } {
    if (actingUser.role === ONLINE_KYC_DESK_ROLE) {
      return { onlineKycVerifierId: actingUser.id };
    }
    if (actingUser.role === OFFLINE_KYC_DESK_ROLE) {
      return { physicalKycAgentId: actingUser.id, onlineKycCompleted: true };
    }
    return {}; // platform_admin (or anything else that made it past the route's requirePermission)
  }

  /** The per-organization counterpart to reviewerScopeFilter above — used everywhere a single
   *  already-fetched org needs an ownership/visibility check. platform_admin is exempt. Throws
   *  NotFoundError (not AuthorizationError) so an org outside a reviewer's scope reads as "doesn't
   *  exist" rather than "exists but you can't touch it" — deliberate for offline_kyc_desk, whose
   *  orgs must be genuinely hidden until onlineKycCompletedAt is set, not just un-actionable. */
  private assertOrgAccessible(
    actingUser: AuthenticatedUser,
    organization: Pick<
      OrganizationEntity,
      'id' | 'onlineKycVerifierId' | 'physicalKycAgentId' | 'onlineKycCompletedAt'
    >,
  ) {
    if (actingUser.role === PLATFORM_ADMIN_ROLE) return;
    if (
      actingUser.role === ONLINE_KYC_DESK_ROLE &&
      organization.onlineKycVerifierId === actingUser.id
    ) {
      return;
    }
    if (
      actingUser.role === OFFLINE_KYC_DESK_ROLE &&
      organization.physicalKycAgentId === actingUser.id &&
      organization.onlineKycCompletedAt !== null
    ) {
      return;
    }
    throw new NotFoundError(`Organization ${organization.id} not found`);
  }

  /** Unlocks only once every submitted document is verified — mirrors the review screen's "docs ✓"
   *  gate. Shared by completeOnlineKyc (the online reviewer's own completion gate) and
   *  approveOrganization (belt-and-suspenders, since completeOnlineKyc should already have run by
   *  then). */
  private async assertDocumentsVerified(organizationId: string) {
    const documents = await this.organizationDocumentService.listByOrganization(organizationId);
    const unverified = documents.filter((document) => document.verificationStatus !== 'verified');
    if (documents.length === 0 || unverified.length > 0) {
      throw new ValidationError('Cannot proceed: every submitted document must be verified first', {
        unverifiedDocumentIds: unverified.map((document) => document.id),
      });
    }
  }

  async updateOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: UpdateOrganizationInput,
  ) {
    try {
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
    } catch (error) {
      rethrow(error, 'Failed to update organization');
    }
  }

  async verifyOrganizationDocument(
    actingUser: AuthenticatedUser,
    organizationId: string,
    documentId: string,
    input: VerifyOrganizationDocumentInput,
  ) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);

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
    } catch (error) {
      rethrow(error, 'Failed to verify organization document');
    }
  }

  /** Assignment itself stays platform_admin-only (see admin.routes.ts) — dispatch/routing is an
   *  admin function — but the field it sets IS the assignee's access scope from then on: see
   *  assertOrgAccessible. Shared logic between the two roles, factored out below as
   *  assignReviewer. */
  async assignOnlineVerifier(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: AssignReviewerInput,
  ) {
    try {
      return await this.assignReviewer(actingUser, organizationId, input.userId, {
        role: ONLINE_KYC_DESK_ROLE,
        field: 'onlineKycVerifierId',
        action: 'ONLINE_KYC_VERIFIER_ASSIGNED',
        journeyStage: 'online_kyc',
      });
    } catch (error) {
      rethrow(error, 'Failed to assign online verifier');
    }
  }

  async assignPhysicalAgent(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: AssignReviewerInput,
  ) {
    try {
      return await this.assignReviewer(actingUser, organizationId, input.userId, {
        role: OFFLINE_KYC_DESK_ROLE,
        field: 'physicalKycAgentId',
        action: 'PHYSICAL_KYC_AGENT_ASSIGNED',
        journeyStage: 'physical_kyc',
      });
    } catch (error) {
      rethrow(error, 'Failed to assign physical agent');
    }
  }

  private async assignReviewer(
    actingUser: AuthenticatedUser,
    organizationId: string,
    userId: string,
    opts: {
      role: string;
      field: 'onlineKycVerifierId' | 'physicalKycAgentId';
      action: AuditAction;
      journeyStage: OrganizationJourneyStage;
    },
  ) {
    try {
      const target = await this.authService.getUserById(userId);
      if (target.role.name !== opts.role) {
        throw new ValidationError(`User ${userId} does not have the "${opts.role}" role`);
      }

      await this.organizationService.updateOrganization(organizationId, {
        [opts.field]: userId,
      });

      const organization = await this.organizationJourneyStageService.recordTransition(
        organizationId,
        opts.journeyStage,
        actingUser.id,
      );

      await this.auditService.log({
        tenantId: organizationId,
        userId: actingUser.id,
        action: opts.action,
        resourceType: 'organization',
        newData: { [opts.field]: userId, journeyStage: organization.journeyStage },
      });

      return organization;
    } catch (error) {
      rethrow(error, 'Failed to assign reviewer');
    }
  }

  /** The online reviewer's handover moment — marks their review done so the assigned
   *  offline_kyc_desk agent can now see and act on this org (see assertOrgAccessible). Gated on
   *  the same "every document verified" check as approveOrganization below. Also the journey-stage
   *  transition to 'online_kyc_completed' — see organization.constants.ts's JOURNEY_STAGE_ORDER
   *  for why an out-of-order physical-agent assignment can make this a no-op display-wise; the
   *  timestamp set here stays the source of truth regardless. */
  async completeOnlineKyc(actingUser: AuthenticatedUser, organizationId: string) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);
      await this.assertDocumentsVerified(organizationId);

      await this.organizationService.updateOrganization(organizationId, {
        onlineKycCompletedAt: new Date(),
      });

      const updated = await this.organizationJourneyStageService.recordTransition(
        organizationId,
        'online_kyc_completed',
        actingUser.id,
      );

      await this.auditService.log({
        tenantId: organizationId,
        userId: actingUser.id,
        action: 'ORGANIZATION_ONLINE_KYC_COMPLETED',
        resourceType: 'organization',
        newData: {
          onlineKycCompletedAt: updated.onlineKycCompletedAt,
          journeyStage: updated.journeyStage,
        },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to complete online KYC');
    }
  }

  /** The offline/physical agent's approval — unconditionally requires completeOnlineKyc to have
   *  run first (checked here regardless of role, unlike assertOrgAccessible's ownership check,
   *  since this is a workflow-order rule that binds platform_admin too, not an access-control
   *  one). Once set, this is what approveOrganization below is waiting on to grant platform
   *  access. Also the journey-stage transition to 'final_approval' — "the ball is back with the
   *  source verifier" for their final decision. */
  async approvePhysicalKyc(actingUser: AuthenticatedUser, organizationId: string) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);
      if (!organization.onlineKycCompletedAt) {
        throw new ValidationError('Cannot approve physical KYC before online KYC is completed');
      }

      await this.organizationService.updateOrganization(organizationId, {
        physicalKycApprovedAt: new Date(),
      });

      const updated = await this.organizationJourneyStageService.recordTransition(
        organizationId,
        'final_approval',
        actingUser.id,
      );

      await this.auditService.log({
        tenantId: organizationId,
        userId: actingUser.id,
        action: 'ORGANIZATION_PHYSICAL_KYC_APPROVED',
        resourceType: 'organization',
        newData: {
          physicalKycApprovedAt: updated.physicalKycApprovedAt,
          journeyStage: updated.journeyStage,
        },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to approve physical KYC');
    }
  }

  /** Unlocks only once every submitted document is verified AND physicalKycApprovedAt is set —
   *  the online-review and physical-review halves of the gate, both unconditional (bind
   *  platform_admin too — see approvePhysicalKyc's doc comment on why these aren't folded into
   *  assertOrgAccessible). Called by the "source verifier" (the assigned online_kyc_desk reviewer)
   *  or platform_admin — never by offline_kyc_desk (blocked at the route level). */
  async approveOrganization(actingUser: AuthenticatedUser, organizationId: string) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);
      await this.assertDocumentsVerified(organizationId);
      if (!organization.physicalKycApprovedAt) {
        throw new ValidationError('Cannot approve: physical KYC has not been approved yet');
      }

      await this.organizationService.updateOrganization(organizationId, {
        status: 'active',
        decisionReason: null,
      });

      const updated = await this.organizationJourneyStageService.recordTransition(
        organizationId,
        'approved',
        actingUser.id,
      );

      await this.auditService.log({
        tenantId: organizationId,
        userId: actingUser.id,
        action: 'ORGANIZATION_APPROVED',
        resourceType: 'organization',
        newData: { status: 'active', journeyStage: updated.journeyStage },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to approve organization');
    }
  }

  async rejectOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: OrganizationDecisionReasonInput,
  ) {
    try {
      return await this.decideOrganization(
        actingUser,
        organizationId,
        input.reason,
        'ORGANIZATION_REJECTED',
      );
    } catch (error) {
      rethrow(error, 'Failed to reject organization');
    }
  }

  async denyOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    input: OrganizationDecisionReasonInput,
  ) {
    try {
      return await this.decideOrganization(
        actingUser,
        organizationId,
        input.reason,
        'ORGANIZATION_DENIED',
      );
    } catch (error) {
      rethrow(error, 'Failed to deny organization');
    }
  }

  /** Reject and Deny both land on status: 'rejected' — the existing OrganizationStatus enum has no
   *  separate value for each — distinguished by which audit action fired and by decisionReason's
   *  text, not by a different status. Deny is online_kyc_desk/platform_admin only (route-gated);
   *  Reject is reachable by either reviewer role, so the ownership check below covers both
   *  branches of assertOrgAccessible. */
  private async decideOrganization(
    actingUser: AuthenticatedUser,
    organizationId: string,
    reason: string,
    action: AuditAction,
  ) {
    try {
      const existing = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, existing);

      await this.organizationService.updateOrganization(organizationId, {
        status: 'rejected',
        decisionReason: reason,
      });

      const organization = await this.organizationJourneyStageService.recordTransition(
        organizationId,
        'rejected',
        actingUser.id,
      );

      await this.auditService.log({
        tenantId: organizationId,
        userId: actingUser.id,
        action,
        resourceType: 'organization',
        newData: { status: 'rejected', reason, journeyStage: organization.journeyStage },
      });

      return organization;
    } catch (error) {
      rethrow(error, 'Failed to decide organization');
    }
  }

  async getOrganizationAuditTrail(
    actingUser: AuthenticatedUser,
    organizationId: string,
    pagination: { page: number; limit: number },
  ) {
    try {
      const organization = await this.organizationService.getOrganizationStatus(organizationId);
      this.assertOrgAccessible(actingUser, organization);

      const { items, total } = await this.auditService.findByOrganization(
        organizationId,
        pagination,
      );
      return paginate(items, total, pagination);
    } catch (error) {
      rethrow(error, 'Failed to fetch organization audit trail');
    }
  }

  async createStaff(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    try {
      return await this.authService.createStaffUser(actingUser, input);
    } catch (error) {
      rethrow(error, 'Failed to create staff');
    }
  }

  async listStaff(input: ListStaffInput) {
    try {
      return await this.authService.listStaffUsers(input);
    } catch (error) {
      rethrow(error, 'Failed to list staff');
    }
  }

  async updateStaff(actingUser: AuthenticatedUser, staffId: string, input: UpdateStaffInput) {
    try {
      return await this.authService.updateStaff(actingUser, staffId, input);
    } catch (error) {
      rethrow(error, 'Failed to update staff');
    }
  }

  async deleteStaff(actingUser: AuthenticatedUser, staffId: string) {
    try {
      await this.authService.deleteStaff(actingUser, staffId);
    } catch (error) {
      rethrow(error, 'Failed to delete staff');
    }
  }

  /** Mirrors assignReviewer's role-check pattern above: when an owner is provided, they must
   *  actually hold the 'sales' role, checked here (not at the schema level, same reasoning as
   *  assignReviewer). ownerUserId is optional — a code can be created unassigned and given an
   *  owner later via updateReferralCode. */
  async createReferralCode(actingUser: AuthenticatedUser, input: CreateReferralCodeInput) {
    try {
      if (input.ownerUserId) {
        const owner = await this.authService.getUserById(input.ownerUserId);
        if (owner.role.name !== SALES_ROLE) {
          throw new ValidationError(
            `User ${input.ownerUserId} does not have the "${SALES_ROLE}" role`,
          );
        }
      }

      const referralCode = await this.referralCodeService.createCode({
        code: input.code,
        ownerUserId: input.ownerUserId ?? null,
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
          validUntil: referralCode.validUntil,
        },
      });

      return referralCode;
    } catch (error) {
      rethrow(error, 'Failed to create referral code');
    }
  }

  async listReferralCodes(input: ListReferralCodesInput) {
    try {
      const { items, total } = await this.referralCodeService.list(input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list referral codes');
    }
  }

  async getReferralCode(referralCodeId: string) {
    try {
      const referralCode = await this.referralCodeService.getById(referralCodeId);
      return { ...referralCode, status: resolveReferralCodeStatus(referralCode) };
    } catch (error) {
      rethrow(error, 'Failed to fetch referral code');
    }
  }

  /** Owner reassignment (if any) is re-checked against the 'sales' role the same way
   *  createReferralCode checks it — a partial body that only touches validUntil skips this check
   *  entirely. Owner/validity only — for revoking/reactivating the code, see
   *  setReferralCodeStatus below instead. */
  async updateReferralCode(
    actingUser: AuthenticatedUser,
    referralCodeId: string,
    input: UpdateReferralCodeInput,
  ) {
    try {
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
          validUntil: before.validUntil,
        },
        newData: {
          ownerUserId: updated.ownerUserId,
          validUntil: updated.validUntil,
        },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update referral code');
    }
  }

  /** Sets a referral code active or revoked directly — idempotent (setting it to its current
   *  state is not an error), and separate from updateReferralCode above (owner/validity only). */
  async setReferralCodeStatus(
    actingUser: AuthenticatedUser,
    referralCodeId: string,
    input: SetReferralCodeStatusInput,
  ) {
    try {
      const before = await this.referralCodeService.getById(referralCodeId);
      const updated = await this.referralCodeService.setStatus(referralCodeId, input.status);

      await this.auditService.log({
        tenantId: null,
        userId: actingUser.id,
        action: input.status === 'revoked' ? 'REFERRAL_CODE_REVOKED' : 'REFERRAL_CODE_REACTIVATED',
        resourceType: 'referral_code',
        oldData: { revokedAt: before.revokedAt },
        newData: { revokedAt: updated.revokedAt },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update referral code status');
    }
  }

  /** Hard delete — only allowed while the code has never been redeemed by an organization (see
   *  OrganizationService.countByReferralCodeId). Once it has, the row has to stay for
   *  attribution/audit history — PATCH .../status is the only option at that point. */
  async deleteReferralCode(actingUser: AuthenticatedUser, referralCodeId: string) {
    try {
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
    } catch (error) {
      rethrow(error, 'Failed to delete referral code');
    }
  }
}
