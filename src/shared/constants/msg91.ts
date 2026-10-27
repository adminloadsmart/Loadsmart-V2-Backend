/** Test phone numbers start with this (after any 91 country code): while MSG91_SKIP_TEST_NUMBERS
 *  is on, no MSG91 notification SMS or WhatsApp goes to them. The login/signup OTP still does, so
 *  they can sign in. */
export const MSG91_SKIPPED_PHONE_PREFIX = '88888';
