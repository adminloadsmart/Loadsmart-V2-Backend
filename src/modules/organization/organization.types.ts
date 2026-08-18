/* Organization onboarding — DTOs and shared onboarding-state types. */

import {
  DocumentVerificationStatus,
  OrganizationDocumentEntity,
  OrganizationDocumentInput,
} from './entities/organization-document.entity';
import { OrganizationEntity, OrganizationOnboardingStep } from './entities/organization.entity';

export type OnboardingStatus = 'incomplete' | 'submitted' | 'completed';
export type OnboardingStep =
  | 'company_details'
  | 'business_details'
  | 'review_submit'
  | 'shopboard_premises_photo'
  | 'submitted';

export interface SaveCompanyDetailsInput {
  companyLegalName: string;
  ownsFleet: boolean;
  address: OrganizationAddressInput;
  referralCode?: string;
}

export interface OrganizationAddressInput {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  areaLocality: string;
  city: string;
  state: string;
  pinCode: string;
}

export interface SaveBusinessDetailsInput {
  documentType: OrganizationDocumentInput['documentType'];
  documentNo?: string;
}

export interface SubmitOrganizationInput {
  step: 'review_submit';
  referralCode?: string;
}

// Returned by OrganizationOnboardingService.getProgress/buildOnboardingState — moved (renamed
// from AuthService's local OrganizationProgress) since it's now a cross-module return type
// consumed directly by auth.service.ts's buildAuthSession.
export type OrganizationOnboardingProgress = {
  onboardingStatus: OnboardingStatus;
  onboardingStep: OrganizationOnboardingStep;
  nextStep: OnboardingStep;
  organization: OrganizationEntity | null;
  documents: OrganizationDocumentEntity[];
};

// Moved (unchanged) from AuthService's local OrganizationReviewData.
export type OrganizationReviewData = {
  companyLegalName: string | null;
  ownsFleet: boolean | null;
  registeredBusinessName: string | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    landmark: string | null;
    areaLocality: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
  };
  referralCode: string | null;
  shopboardPremisesPhotoKey: string | null;
  documents: Array<{
    documentType: string;
    documentNumber: string | null;
    documentUrl: string | null;
    verificationStatus: DocumentVerificationStatus;
  }>;
};
