import { DriverBloodGroup, DriverOnboardingStep } from './drivers.types';
import { AddDriverDocumentInput } from './drivers.interface';
import { DriverDeviceCaptureInput } from './driver-auth.types';
import { DriverEntity } from './entities/driver.entity';

export interface RequestDriverRegisterOtpInput {
  phoneNumber: string;
}

export interface VerifyDriverRegisterOtpInput {
  phoneNumber: string;
  otp: string;
}

export interface RegisterBankDetailsInput {
  accountNumber: string;
  ifsc: string;
  accountHolderName?: string;
  upiId?: string;
}

/**
 * "Complete my registration details" — screen 1 (mandatory) plus screens 2/3 (optional) of the
 * self-registration form. Callable more than once: a driver who abandons after the phone-
 * verification step (see DriverIdentityService.verifyOtp, which already creates the shell
 * profile) resumes here later, whether that's their first attempt or a retry after logging back
 * in. No tenant context — a global profile isn't employed by anyone yet.
 */
export interface RegisterDriverInput {
  // Screen 1 — mandatory
  fullName: string;
  licenseNumber: string;
  dateOfBirth: string;
  // License photos — optional per individual call (this call is resumable, so a driver can send
  // them on a later call instead of this one), but both driving_license_front and
  // driving_license_back must exist for the driver, cumulatively across calls, by the time this
  // succeeds — see DriverIdentityService.completeRegistration. Always required now, regardless
  // of Sarathi's verification result.
  documents?: AddDriverDocumentInput[];
  // Screen 2 — optional
  bloodGroup?: DriverBloodGroup;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  hasLifeInsurance?: boolean;
  hasHealthInsurance?: boolean;
  // Screen 3 — optional
  bankDetails?: RegisterBankDetailsInput;
  // Kept as optional extras — not part of any screen, but not removed either.
  licenseExpiry?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  // Resume-position bookmark the client reports on each call — see drivers.types.ts's
  // DRIVER_ONBOARDING_STEPS doc comment for why this can't be computed server-side instead.
  onboardingStep?: DriverOnboardingStep;
}

export interface RequestJoinTenantInput {
  tenantId: string;
}

export interface RespondToInviteInput {
  accept: boolean;
  reason?: string;
}

/** Returned by phone verification (registration or a resumed login) — a usable session even
 * before registration details are complete. */
export interface DriverIdentitySession {
  driverId: string;
  accessToken: string;
  refreshToken: string;
}

export interface CompleteRegistrationResult {
  driverId: string;
  licenseVerificationStatus: 'verified' | 'manual_review' | null;
  // Full profile — fullName, phoneNumber, license fields, blood group, address, emergency
  // contact + relation, hasHealthInsurance, hasLifeInsurance, onboardingStep, registrationSource,
  // plus documents/verifications/bankDetails — so the client can render the driver's own profile
  // straight from this response, on the first call or a resumed one.
  driver: DriverEntity;
}

export type { DriverDeviceCaptureInput };
