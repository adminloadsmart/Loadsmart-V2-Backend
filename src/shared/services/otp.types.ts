import type { OtpChannel } from '../../modules/auth/auth.constants';
import type { MessageRef } from '../i18n/translate';

/** OtpService.requestOtpCode — send a fresh code to a phone for one login/signup `purpose`. */
export interface RequestOtpCodeInput {
  phoneNumber: string;
  purpose: string;
  cooldownSeconds: number;
  /** Client IP (req.ip) — for LS_N_0008's per-IP request limit. Omitted = per-phone only. */
  ipAddress?: string | null;
  /** Send on this channel only (driver app). Omitted = SMS plus a best-effort WhatsApp copy. */
  channel?: OtpChannel;
}

/** OtpService.verifyOtpCode — check a code against the one sent for the same `purpose`. */
export interface VerifyOtpCodeInput {
  phoneNumber: string;
  otp: string;
  purpose: string;
  ttlSeconds: number;
  invalidOtpMessage: string | MessageRef;
  tooManyAttemptsMessage: string | MessageRef;
}
