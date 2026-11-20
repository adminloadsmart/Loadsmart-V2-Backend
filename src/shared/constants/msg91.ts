/** Test phone numbers start with this (after any 91 country code): while MSG91_SKIP_TEST_NUMBERS
 *  is on, no MSG91 notification SMS or WhatsApp goes to them. The login/signup OTP still does, so
 *  they can sign in. */
export const MSG91_SKIPPED_PHONE_PREFIX = '88888';

/** Every Meta WhatsApp message id (WAMID) starts with this. */
export const WHATSAPP_MESSAGE_ID_PREFIX = 'wamid.';

/** How deep a send response is searched for a WAMID (it may sit under `data` or in an array). */
export const WHATSAPP_MESSAGE_ID_SEARCH_DEPTH = 3;
