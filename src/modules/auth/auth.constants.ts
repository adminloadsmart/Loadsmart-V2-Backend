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
