import { env } from '../../config/env';

export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const MAX_OTP_ATTEMPTS = 5;
export const SIGNUP_RESEND_COOLDOWN_SECONDS = 30;

// Dev-only stand-in for MSG91 delivery, so signup/login OTP flows work locally without real
// MSG91 credentials or sending real SMS. Only ever accepted when useDevOtpBypass() is true.
export const DEV_BYPASS_OTP = '1234';

// True whenever MSG91 isn't configured outside production — auth.service.ts's requestOtpCode /
// verifyOtpCode use this to skip Msg91Client entirely and accept/emit DEV_BYPASS_OTP instead.
// Hard-gated on nodeEnv (not just "is MSG91 configured") so a prod deploy that's missing MSG91
// credentials fails loudly via Msg91Client rather than silently accepting '1234' from anyone.
export function useDevOtpBypass(): boolean {
  return env.nodeEnv !== 'production' && !env.msg91AuthKey;
}

// A precomputed bcrypt hash of an arbitrary fixed string (cost 10, matching every real hash in
// this app — see auth.service.ts's createStaffUser/createOrganization). login() compares against
// this when no real user/passwordHash exists, purely so the bcrypt.compare cost — and therefore
// response time — is the same whether or not the email is real. Never a valid credential: no
// signup path can ever produce this exact hash for a real password.
export const DUMMY_PASSWORD_HASH = '$2b$10$io8urkhUVVd1M92BO1e3DOWFc7FNJ.om.91oinicrZslYBmbhwiRW';
