import { env } from '../../config/env';
import { MSG91_SKIPPED_PHONE_PREFIX } from '../constants/msg91';

export function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D+/g, '');
}

/**
 * The MSG91-facing form of an (Indian-only) phone number: country code 91 + the 10-digit number.
 * Stored numbers never carry the 91 (see normalizePhoneNumber) — it's added only here, at the
 * edge, when a number is handed to MSG91 (OTP, SMS, WhatsApp). A value that already has it
 * (12 digits starting with 91, e.g. "+91 98765 00000" from a client) is left as-is, so it can
 * never become 9191…; anything else is passed through unchanged for MSG91 to validate.
 */
/** "+919876500000" for a valid Indian mobile number (10 digits, or 12 starting with 91); null for
 *  anything else — for a client that dials the number itself (e.g. a notification's "Call
 *  driver" button). */
export function toInternationalIndianNumber(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;
  const msisdn = toIndianMsisdn(phoneNumber);
  return /^91\d{10}$/.test(msisdn) ? `+${msisdn}` : null;
}

export function toIndianMsisdn(phoneNumber: string): string {
  const digits = normalizePhoneNumber(phoneNumber);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** A test number (MSG91_SKIPPED_PHONE_PREFIX) while MSG91_SKIP_TEST_NUMBERS is on — no MSG91
 *  notification SMS/WhatsApp is sent to it. */
export function isMsg91SkippedNumber(phoneNumber: string): boolean {
  return (
    env.msg91SkipTestNumbers &&
    toIndianMsisdn(phoneNumber).startsWith(`91${MSG91_SKIPPED_PHONE_PREFIX}`)
  );
}
