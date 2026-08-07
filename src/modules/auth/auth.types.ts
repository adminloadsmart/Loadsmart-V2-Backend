/* Service-layer inputs — shapes accepted by AuthService's methods. */

import { OrganizationDocumentInput } from './entities/organization-document.entity';

export type OnboardingStatus = 'incomplete' | 'submitted' | 'completed';
export type OnboardingStep = 'company_details' | 'business_details' | 'review_submit' | 'submitted';

export interface SignupInput {
  phoneNumber: string;
}

export interface VerifyOtpInput {
  phoneNumber: string;
  otp: string;
}

export interface CreateStaffInput {
  fullName: string;
  phoneNumber: string;
  email: string;
  roleId: string;
  coverage: string;
  // Extra permissions granted on top of whatever roleId already grants — see
  // auth.service.ts's createStaffUser.
  permissionIds?: string[];
}

export interface LoginInput {
  phoneNumber: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
  // The caller's own id (from req.user, never the request body) — logout must only ever revoke
  // the caller's own refresh token, not one they happen to be holding for another user.
  userId: string;
  jti?: string;
  exp?: number;
}

export interface CreatePasswordInput {
  password: string;
  confirmPassword: string;
}

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

export interface CompleteCompanyProfileInput {
  // Required on first-time submission only — see auth.service.ts's createOrganization.
  email?: string;
  password?: string;
  name: string;
  companyLegalName: string;
  orgAdminName: string;
  operationalCity: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  district: string;
  state: string;
  hasOwnFleet: boolean;
  fleetSize?: number;
  documents?: OrganizationDocumentInput[];
  // Optional — attributes this organization to a sales rep at signup only. Validated against
  // ReferralCodeService.validateAndResolve; ignored on later profile updates (tenantId already
  // present) since attribution is set once and never changed. See auth.service.ts's createOrganization.
  referralCode?: string;
}
