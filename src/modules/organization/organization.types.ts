/* Organization onboarding — DTOs and shared onboarding-state types. */

import {
  OrganizationDocumentEntity,
  OrganizationDocumentInput,
} from './entities/organization-document.entity';
import { OrganizationEntity, OrganizationOnboardingStep } from './entities/organization.entity';

export type OnboardingStatus = 'incomplete' | 'submitted' | 'completed';
export type OnboardingStep = 'company_details' | 'business_details' | 'review_submit' | 'submitted';

export interface SaveCompanyDetailsInput {
  companyLegalName: string;
  contactPersonName: string;
  operatingCity: string;
  ownsFleet: boolean;
  fleetSize?: number;
  referralCode?: string;
}

export interface SaveBusinessDetailsInput {
  registeredBusinessName: string;
  registrationDate?: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    district: string;
    state: string;
    pinCode: string;
  };
  documents: OrganizationDocumentInput[];
}

export interface SubmitOrganizationInput {
  step: 'review_submit';
  companyLegalName: string;
  contactPersonName: string;
  operatingCity: string;
  ownsFleet: boolean;
  fleetSize?: number;
  referralCode?: string;
  registeredBusinessName: string;
  registrationDate?: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    district: string;
    state: string;
    pinCode: string;
  };
  documents: OrganizationDocumentInput[];
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
  contactPersonName: string | null;
  operatingCity: string | null;
  ownsFleet: boolean | null;
  fleetSize: number | null;
  registeredBusinessName: string | null;
  registrationDate: string | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pinCode: string | null;
  };
  referralCode: string | null;
  documents: Array<{
    documentType: string;
    documentNumber: string | null;
    documentUrl: string | null;
    isVaild: boolean;
  }>;
};
