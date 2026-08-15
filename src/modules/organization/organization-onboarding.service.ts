import { ValidationError } from '../../shared/errors';
import { OrganizationService } from './organization.service';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationEntity, OrganizationOnboardingStep } from './entities/organization.entity';
import { OrganizationDocumentEntity } from './entities/organization-document.entity';
import { OrganizationOnboardingProgress, OrganizationReviewData } from './organization.types';

/** The organization onboarding state machine — deliberately never sees a UserEntity, a role, or a
 *  token. Everything here is keyed by tenantId/organization + document data only. Composes
 *  OrganizationService + OrganizationDocumentService and adds orchestration on top, mirroring
 *  masters/fleet-driver-link.service.ts's pattern — kept as its own class rather than growing
 *  OrganizationService itself, since OrganizationService stays a thin CRUD facade shared by
 *  admin/TenancyGatewayLocal, neither of which needs any of this workflow logic.
 *
 *  Called by AuthService, which still owns the actual onboarding endpoints (getOrganization/
 *  createOrganization/saveBusinessDetails/submitOrganization) since those also mutate the
 *  caller's own session (tenantId + token pair) — auth-only concerns this module can't own. */
export class OrganizationOnboardingService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
  ) {}

  // Used by AuthService.getOnboardingProgress when the caller already has a tenantId — the
  // no-tenantId branch (a brand new org_admin vs. a brand new staff user) stays in AuthService
  // since it depends on the user's role, which this service never sees.
  async getProgress(tenantId: string): Promise<OrganizationOnboardingProgress> {
    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(tenantId),
      this.organizationDocumentService.listByOrganization(tenantId),
    ]);

    return this.buildOnboardingState(organization, documents);
  }

  buildOnboardingState(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationOnboardingProgress {
    const onboardingStep = this.resolveOnboardingStep(organization, documents);

    if (organization.status === 'active') {
      return {
        onboardingStatus: 'completed',
        onboardingStep: 'submitted',
        nextStep: 'submitted',
        organization,
        documents,
      };
    }

    if (organization.status === 'pending' || organization.submittedAt) {
      return {
        onboardingStatus: 'submitted',
        onboardingStep,
        nextStep: onboardingStep,
        organization,
        documents,
      };
    }

    return {
      onboardingStatus: 'incomplete',
      onboardingStep,
      nextStep: this.resolveNextStep(onboardingStep, organization),
      organization,
      documents,
    };
  }

  buildOrganizationResponse(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationOnboardingProgress & {
    organization: OrganizationEntity;
    documents: OrganizationDocumentEntity[];
    reviewData: OrganizationReviewData;
  } {
    const state = this.buildOnboardingState(organization, documents);
    return {
      ...state,
      organization,
      documents,
      reviewData: this.buildReviewData(organization, documents),
    };
  }

  nextStepAfterCompanyDetails(
    currentStep: OrganizationOnboardingStep | null,
  ): OrganizationOnboardingStep {
    if (currentStep === 'review_submit' || currentStep === 'submitted') {
      return currentStep;
    }
    return 'business_details';
  }

  nextStepAfterBusinessDetails(
    currentStep: OrganizationOnboardingStep | null,
  ): OrganizationOnboardingStep {
    if (currentStep === 'submitted') {
      return 'submitted';
    }
    return 'shopboard_premises_photo';
  }

  // Single gate replacing the 3 separate asserts submitOrganization used to call inline —
  // AuthService doesn't need to know which specific check failed.
  assertReadyForSubmission(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): void {
    this.assertCompanyDetailsComplete(organization);
    this.assertBusinessDetailsComplete(organization);
    this.assertDocumentsReady(documents);
    this.assertShopboardPremisesPhotoPresent(organization);
  }

  private hasCompanyDetails(organization: OrganizationEntity): boolean {
    return Boolean(
      organization.companyLegalName &&
      organization.orgAdminName &&
      organization.operationalCity &&
      organization.hasOwnFleet !== null,
    );
  }

  private hasBusinessDetails(organization: OrganizationEntity): boolean {
    return Boolean(
      organization.registeredBusinessName &&
      organization.addressLine1 &&
      organization.city &&
      organization.district &&
      organization.state &&
      organization.pinCode,
    );
  }

  private assertCompanyDetailsComplete(organization: OrganizationEntity): void {
    if (!this.hasCompanyDetails(organization)) {
      throw new ValidationError('Company details are incomplete');
    }
  }

  private assertBusinessDetailsComplete(organization: OrganizationEntity): void {
    if (!this.hasBusinessDetails(organization)) {
      throw new ValidationError('Business details are incomplete');
    }
  }

  private assertDocumentsPresent(documents: OrganizationDocumentEntity[]): void {
    if (documents.length === 0) {
      throw new ValidationError('At least one document is required before submission');
    }
  }

  private assertDocumentsReady(documents: OrganizationDocumentEntity[]): void {
    this.assertDocumentsPresent(documents);
    const invalidDocuments = documents.filter(
      (document) => !document.documentNumber && !document.fileKey,
    );
    if (invalidDocuments.length > 0) {
      throw new ValidationError(
        'Each document must include either a document number or a document URL',
      );
    }
  }

  private assertShopboardPremisesPhotoPresent(organization: OrganizationEntity): void {
    if (!organization.shopboardPremisesPhotoKey) {
      throw new ValidationError('Shop-board premises photo is required before submission');
    }
  }

  private resolveOnboardingStep(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationOnboardingStep {
    if (organization.onboardingStep) {
      return organization.onboardingStep;
    }
    if (organization.status === 'pending' || organization.submittedAt) {
      return 'submitted';
    }
    if (!this.hasCompanyDetails(organization)) {
      return 'company_details';
    }
    if (!this.hasBusinessDetails(organization)) {
      return 'business_details';
    }
    if (!documents.length) {
      return 'review_submit';
    }
    return 'review_submit';
  }

  // Business details are followed by the shop-board upload. The persisted step remains
  // shopboard_premises_photo until the upload has actually stored a photo key; only then can the
  // UI resume at final review/submit. The review_submit fallback supports organizations created
  // before the shop-board step was introduced.
  private resolveNextStep(
    onboardingStep: OrganizationOnboardingStep,
    organization: OrganizationEntity,
  ): OrganizationOnboardingStep {
    if (
      (onboardingStep === 'review_submit' || onboardingStep === 'shopboard_premises_photo') &&
      !organization.shopboardPremisesPhotoKey
    ) {
      return 'shopboard_premises_photo';
    }
    if (
      onboardingStep === 'review_submit' ||
      (onboardingStep === 'shopboard_premises_photo' && organization.shopboardPremisesPhotoKey)
    ) {
      return 'review_submit';
    }
    return onboardingStep;
  }

  private buildReviewData(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationReviewData {
    return {
      companyLegalName: organization.companyLegalName,
      contactPersonName: organization.orgAdminName,
      operatingCity: organization.operationalCity,
      ownsFleet: organization.hasOwnFleet,
      registeredBusinessName: organization.registeredBusinessName,
      address: {
        addressLine1: organization.addressLine1,
        addressLine2: organization.addressLine2,
        city: organization.city,
        district: organization.district,
        state: organization.state,
        pinCode: organization.pinCode,
      },
      referralCode: organization.referralCode?.code ?? null,
      shopboardPremisesPhotoKey: organization.shopboardPremisesPhotoKey,
      documents: documents.map((document) => ({
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        documentUrl: document.fileKey,
        isVaild: document.isVaild,
      })),
    };
  }
}
