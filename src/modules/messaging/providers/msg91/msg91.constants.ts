// MSG91 WhatsApp specifics. Only files in providers/msg91/ import this.

/** MSG91 webhook (New): `direction` 0 = inbound (the user wrote to us), 1 = outbound (a report on
 *  a message we sent). "How to Receive WhatsApp Delivery Reports via Webhook (New)". */
export const MSG91_DIRECTION_INBOUND = '0';
export const MSG91_DIRECTION_OUTBOUND = '1';

/** Report `eventName` / `status` values (MSG91 webhook (New): sent / delivered / read / failed). */
export const MSG91_STATUS_EVENTS = ['sent', 'delivered', 'read', 'failed'] as const;

/** Fields MSG91 sends as stringified JSON ("such as messages, content, button etc"). */
export const MSG91_STRINGIFIED_FIELDS = ['content', 'button', 'messages', 'interactive'] as const;

/** HTTP statuses that are worth a retry from the outbound worker. */
export const MSG91_RETRYABLE_HTTP = [429, 500, 502, 503, 504];
export const MSG91_AUTH_HTTP = [401, 403];

/** A timestamp below this is in seconds, at or above it in milliseconds. */
export const EPOCH_MILLISECONDS_FLOOR = 1e12;
export const MILLISECONDS_PER_SECOND = 1000;
