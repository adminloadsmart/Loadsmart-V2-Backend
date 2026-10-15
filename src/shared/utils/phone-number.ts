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
export function toIndianMsisdn(phoneNumber: string): string {
  const digits = normalizePhoneNumber(phoneNumber);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}
