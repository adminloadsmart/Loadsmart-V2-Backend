// Value lists for the provider-neutral WhatsApp messaging layer. Nothing here is Meta- or
// MSG91-specific: providers translate their own payloads into these shapes (see
// providers/whatsapp-provider.interface.ts).

/** WhatsApp goes through MSG91 only (the direct Meta Cloud API adapter was removed on 18 Nov). */
export const WHATSAPP_PROVIDERS = ['msg91'] as const;
export type WhatsappProviderName = (typeof WHATSAPP_PROVIDERS)[number];

/** What an outbound message was for — the reply router uses it to know what a reply answers. */
export const OUTBOUND_MESSAGE_KINDS = [
  'offer',
  'rate_request',
  'price_request',
  'dispatch_request',
  'slip_request',
  'picker',
  'info',
  'template',
] as const;
export type OutboundMessageKind = (typeof OUTBOUND_MESSAGE_KINDS)[number];

export const MESSAGE_LOG_STATUSES = [
  'queued',
  'submitted',
  'sent',
  'delivered',
  'read',
  'failed',
  'deleted',
  'suppressed',
] as const;
export type MessageLogStatus = (typeof MESSAGE_LOG_STATUSES)[number];

/** Delivery statuses a provider reports for one of our messages. */
export const DELIVERY_STATUS_EVENTS = ['sent', 'delivered', 'read', 'failed', 'deleted'] as const;
export type DeliveryStatusEvent = (typeof DELIVERY_STATUS_EVENTS)[number];

/** action = the recipient must act (WhatsApp + app); update = information (app only for shippers). */
export const MESSAGE_INTENTS = ['action', 'update'] as const;
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];

export const MESSAGE_RECIPIENT_KINDS = [
  'shipper_user',
  'transporter',
  'partner',
  'driver',
  'receiver',
  'contact',
] as const;
export type MessageRecipientKind = (typeof MESSAGE_RECIPIENT_KINDS)[number];

export const INBOUND_MESSAGE_TYPES = [
  'text',
  'button',
  'list_pick',
  'flow_reply',
  'image',
  'document',
  'other',
] as const;
export type InboundMessageType = (typeof INBOUND_MESSAGE_TYPES)[number];

/** Which rule found the load for an inbound message (stored as evidence on whatsapp_inbound). */
export const ROUTING_METHODS = [
  'context_id',
  'button_id',
  'flow_token',
  'only_pending',
  'load_picker',
  'none',
] as const;
export type RoutingMethod = (typeof ROUTING_METHODS)[number];

export const INBOUND_RESOLUTIONS = [
  'pending',
  'bid_recorded',
  'accepted',
  'negotiating',
  'rejected',
  'details_received',
  'validation_failed',
  'slip_received',
  'awaiting_load_pick',
  'changed_answer',
  'repeat_tap',
  'needs_review',
  'late',
  'ignored',
] as const;
export type InboundResolution = (typeof INBOUND_RESOLUTIONS)[number];

/** Kinds of value a typed / attached reply can carry. */
export const REPLY_VALUE_KINDS = ['rate', 'truck', 'dispatch', 'slip'] as const;
export type ReplyValueKind = (typeof REPLY_VALUE_KINDS)[number];

/** Provider-neutral send failures (each provider maps its own error codes to these). */
export const SEND_ERROR_CODES = [
  'token_invalid',
  'rate_limited',
  'window_closed',
  'recipient_not_allowed',
  'invalid_parameter',
  'network',
  'unknown',
] as const;
export type SendErrorCode = (typeof SEND_ERROR_CODES)[number];

/** Actions encoded in our reply-button ids / template button payloads. */
export const OFFER_ACTIONS = ['accept', 'negotiate', 'reject', 'give_rate'] as const;
export type OfferAction = (typeof OFFER_ACTIONS)[number];

/** Where a recipient stands on one load — decides which reply values that load accepts. */
export const RECIPIENT_LOAD_STAGES = [
  'offered',
  'awaiting_rate',
  /** Accepted / rate given; the truck number is still to come ("Send the truck number if you have it"). */
  'awaiting_truck',
  'awaiting_dispatch',
  'awaiting_slip',
  'closed',
] as const;
export type RecipientLoadStage = (typeof RECIPIENT_LOAD_STAGES)[number];

/** Follow-up questions the router asks after an action (sent by the outbound side, Part 4). */
export const REPLY_PROMPTS = [
  'rate_request',
  // The shipper's counter to Loadsmart's bid (LS_N_0067 Counter): "Type your price in ₹".
  'price_request',
  'dispatch_request',
  'slip_request',
] as const;
export type ReplyPrompt = (typeof REPLY_PROMPTS)[number];

/** Every channel a message can go out on (the app's in-app card is not a channel here — it is
 *  always kept). */
export const POLICY_CHANNELS = ['whatsapp', 'sms', 'email', 'push'] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];
