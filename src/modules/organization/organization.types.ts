/* Organization onboarding — DTOs and shared onboarding-state types. */

import {
  DocumentVerificationStatus,
  OrganizationDocumentEntity,
  OrganizationDocumentInput,
} from './entities/organization-document.entity';
import {
  OrganizationEntity,
  OrganizationJourneyStage,
  OrganizationOnboardingStep,
  OrganizationStatus,
} from './entities/organization.entity';
import { DateFilter } from '../../shared/utils/date-filter';
import type { AuditService } from '../audit/audit.service';
import type { OrganizationService } from './organization.service';

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
  replaceDocumentType?: OrganizationDocumentInput['documentType'];
  documentFront?: string | string[];
  shopPremisesPhoto?: string;
  registeredAddress?: OrganizationRegisteredAddressInput;
}

export interface OrganizationRegisteredAddressInput {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pinCode: string;
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
  organization: Omit<OrganizationEntity, 'shopboardPremisesPhotoKey'> | null;
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
  documents: Array<{
    documentType: string;
    documentNumber: string | null;
    documentUrl: string | null;
    documentUrls: string[];
    registeredAddress: OrganizationRegisteredAddressInput | null;
    verificationStatus: DocumentVerificationStatus;
  }>;
};

export interface LateDeliverySetting {
  /** The limit in force — the company's own, else the default. */
  thresholdMinutes: number;
  /** True when the company never set one (or reset it). */
  isDefault: boolean;
  defaultThresholdMinutes: number;
}

/** What the onboarding router needs besides authService (createOrganizationOnboardingRoutes). */
export interface OrganizationOnboardingDeps {
  organizationService: OrganizationService;
  auditService: AuditService;
}

export interface OrganizationListFilters {
  // One status, or several (e.g. the queue's Rejected tab = rejected + suspended).
  status?: OrganizationStatus | OrganizationStatus[];
  // Leaves out sign-ups that were never submitted — the verification queue's view.
  excludeDrafts?: boolean;
  journeyStage?: OrganizationJourneyStage;
  search?: string;
  filter?: DateFilter;
  from?: string;
  to?: string;
  // Role-scoping — see AdminService.listOrganizations, the only caller that sets these (for
  // online_kyc_desk/offline_kyc_desk callers; platform_admin leaves them undefined).
  onlineKycVerifierId?: string;
  physicalKycAgentId?: string;
  onlineKycCompleted?: boolean;
}

export interface OrganizationQueueSummary {
  total: number;
  pending: number;
  partialPending: number;
  approved: number;
  // rejected + suspended
  rejected: number;
  // Pending and submitted more than 24h ago.
  overdue: number;
  // Approved today (IST), whenever the org was created — ignores the date range.
  approvedToday: number;
}

/** Referral signups: submitted orgs (drafts left out) that used the code(s), and how many of
 *  those are approved ('active'). */
export interface ReferralSignupCounts {
  total: number;
  approved: number;
}

/** Counts for the admin Referral Codes cards. */
export interface ReferralCodeSummary {
  total: number;
  active: number;
  expired: number;
  revoked: number;
}

/** The salesperson a code is made for at hire. */
export interface ReferralCodeOwner {
  id: string;
  fullName: string | null;
  coverage: string | null;
}
