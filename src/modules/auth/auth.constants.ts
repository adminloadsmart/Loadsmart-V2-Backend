export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const MAX_OTP_ATTEMPTS = 5;
export const SIGNUP_RESEND_COOLDOWN_SECONDS = 30;

// A precomputed bcrypt hash of an arbitrary fixed string (cost 10, matching every real hash in
// this app — see auth.service.ts's createStaffUser/createOrganization). login() compares against
// this when no real user/passwordHash exists, purely so the bcrypt.compare cost — and therefore
// response time — is the same whether or not the email is real. Never a valid credential: no
// signup path can ever produce this exact hash for a real password.
export const DUMMY_PASSWORD_HASH = '$2b$10$io8urkhUVVd1M92BO1e3DOWFc7FNJ.om.91oinicrZslYBmbhwiRW';
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const AADHAAR_REGEX = /^[2-9][0-9]{11}$/;
export const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;

// A referral code as admin-typed/generated: uppercase letters/digits plus - and _, 4-40 chars.
// Enforced both at the API boundary (admin.validators.ts's createReferralCode) and again in
// referral-code.service.ts (defense in depth for any other caller of createCode).
export const REFERRAL_CODE_REGEX = /^[A-Z0-9_-]{4,40}$/;

// Per-type format check for a submitted organization document's `documentNumber` — see
// auth.validators.ts's createOrganization. `shop_establishment` has no standardized national
// number format (state-specific), so it's validated as a non-empty string only (null here means
// "no regex check").
export const DOCUMENT_NUMBER_REGEX: Record<
  import('./entities/organization-document.entity').OrganizationDocumentType,
  RegExp | null
> = {
  gst_certificate: GSTIN_REGEX,
  pan: PAN_REGEX,
  udyam: UDYAM_REGEX,
  aadhaar: AADHAAR_REGEX,
  cin: CIN_REGEX,
  shop_establishment: null,
};
