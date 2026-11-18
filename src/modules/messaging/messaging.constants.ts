import { DeliveryStatusEvent, MessageLogStatus, MessageRecipientKind } from './messaging.types';

/** WhatsApp interactive-message limits (Meta; checked live 13 Nov — a list with 11 rows → 131009). */
export const WHATSAPP_INTERACTIVE_LIMITS = {
  replyButtonsMax: 3,
  buttonTitleMaxChars: 20,
  buttonIdMaxChars: 256,
  listRowsMax: 10,
  listRowTitleMaxChars: 24,
  listRowIdMaxChars: 200,
  listRowDescriptionMaxChars: 72,
  listButtonTextMaxChars: 20,
  headerMaxChars: 60,
  footerMaxChars: 60,
  bodyMaxChars: 1024,
} as const;

/**
 * Forward-only rank of delivery statuses: a late `sent` never overwrites `read`, and `read`
 * implies `delivered` (Meta often skips `delivered` — 0 of 26 live). `failed` / `deleted` are
 * terminal and handled separately.
 */
export const DELIVERY_STATUS_RANK: Record<
  Exclude<DeliveryStatusEvent, 'failed' | 'deleted'>,
  number
> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Our ids inside interactive messages: `action:loadRef:recipientRef` and `load:loadRef`. */
export const BUTTON_ID_SEPARATOR = ':';
export const LIST_ROW_ID_PREFIX = 'load:';

/** A typed rate outside this range is not treated as a rate (avoids "10 baje" → ₹10). */
export const TYPED_RATE_RANGE = { min: 1_000, max: 1_000_000 } as const;
export const RATE_SUFFIX_MULTIPLIER = 1_000; // "45k", "45 hazar"

export const INDIAN_TRUCK_NUMBER_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
export const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;
export const INDIAN_MOBILE_DIGITS = 10;

/** 24-h customer service window: session messages only inside it, templates outside. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const MESSAGING_QUEUES = {
  outbound: 'whatsapp-outbound',
  inbound: 'whatsapp-inbound',
} as const;

/** Under Meta's 80 msg/s default throughput. */
export const OUTBOUND_SEND_RATE_PER_SECOND = 50;

/** Inbound processing: one sender at a time, in arrival order (finding G2). */
export const INBOUND_SENDER_LOCK_PREFIX = 'whatsapp:sender-lock:';
export const INBOUND_SENDER_LOCK_TTL_MS = 30_000;
export const INBOUND_SENDER_BATCH_SIZE = 50;
export const INBOUND_JOB_NAMES = {
  processSender: 'process-sender',
  applyStatus: 'apply-status',
} as const;
/** A busy sender lock is retried quickly; many attempts so a burst never drops a message. */
export const INBOUND_JOB_RETRY = { attempts: 20, backoffMs: 1_000 } as const;
export const INBOUND_WORKER_CONCURRENCY = 5;
/** Lock key prefix that serialises delivery statuses per message_log row. */
export const STATUS_LOCK_PREFIX = 'status:';

/** Which recipient-load stages accept each kind of typed / attached value. */
export const STAGES_ACCEPTING_VALUE = {
  // A new rate also revises a bid whose truck number is still to come.
  rate: ['awaiting_rate', 'offered', 'awaiting_truck'],
  truck: ['awaiting_truck'],
  dispatch: ['awaiting_dispatch'],
  slip: ['awaiting_slip'],
} as const;

/** A typed value waiting for a "Load chunein" pick expires after this (finding G4). */
export const LOAD_PICK_TTL_MS = 24 * 60 * 60 * 1000;

/** Inbound resolutions that count as the recipient's decision on an offer (changed-answer guard). */
export const DECISIVE_RESOLUTIONS = [
  'accepted',
  'negotiating',
  'rejected',
  'bid_recorded',
] as const;

/** A recipient's answer to an offer that decides its next stage (Part 5 stage memory). */
export const OFFER_ANSWER_RESOLUTIONS = ['accepted', 'negotiating', 'rejected'] as const;

/** How far back an unanswered indent stays answerable on WhatsApp (an indent has no 4-h window). */
export const INDENT_OFFER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Max length of a "Load chunein" row description (Meta list rows: 72 chars). */
export const LANE_LABEL_MAX_LENGTH = 72;

export const OUTBOUND_JOB_NAME = 'send';
export const OUTBOUND_JOB_RETRY = { attempts: 5, backoffMs: 2_000 } as const;

/** Why a message was not sent (stored in message_log.suppressed_reason). */
export const SUPPRESSED_REASONS = {
  windowClosedNoTemplate: 'window_closed_no_template',
  templateNotConfigured: 'template_not_configured',
  noOptIn: 'no_opt_in',
  providerNotConfigured: 'provider_not_configured',
  /** Channel rules (channel-policy.ts). */
  updateAppOnly: 'update_app_only',
  beforeLoadMemo: 'before_load_memo',
  driverUsesApp: 'driver_uses_app',
  receiverSmsOnly: 'receiver_sms_only',
  supplySideWhatsappOnly: 'supply_side_whatsapp_only',
} as const;

/** Session prompts that must become a template once the 24-h window has closed (finding G1). */
export const PROMPT_FALLBACK_TEMPLATES = {
  rate_request: null,
  dispatch_request: null,
  slip_request: null,
} as const;

export const LOAD_PICKER_LABELS = {
  buttonText: 'Choose load',
  sectionTitle: 'Your open loads',
} as const;

/** A delivery report with an unknown request id is matched to the latest message to that number
 *  sent this long before the report (plan note 17). */
export const STATUS_MATCH_WINDOW_MS = 30 * 60 * 1000;

/** The URL set in the MSG91 panel (with `?token=MSG91_WEBHOOK_TOKEN`). Mounted in publicRouters,
 *  so the full path is POST /v1/webhooks/msg91/whatsapp. */
export const MSG91_WHATSAPP_WEBHOOK_PATH = '/webhooks/msg91/whatsapp';

/** Only a wrong token gets a 4xx (MSG91 pauses a webhook that answers 4XX). */
export const WEBHOOK_RESPONSE_STATUS = { ok: 200, unauthorized: 401 } as const;

/** Window of the outbound BullMQ limiter (OUTBOUND_SEND_RATE_PER_SECOND per window). */
export const OUTBOUND_LIMITER_WINDOW_MS = 1_000;

/** `actor` on message_log rows we send on our own. */
export const MESSAGING_ACTORS = {
  loadBoard: 'system:load-board',
  loadPosting: 'system:load-posting',
  notifications: 'system:notifications',
  replyRouter: 'whatsapp:reply-router',
} as const;

/** A WhatsApp report that means the offer reached the transporter (load_recipients → sent). */
export const REACHED_DELIVERY_STATUSES: readonly MessageLogStatus[] = ['sent', 'delivered', 'read'];

/** Loads a transporter can still answer on WhatsApp (market + indent postings, not yet assigned). */
export const WHATSAPP_ANSWERABLE_LOAD_STATUSES = ['created', 'bids_received'] as const;
export const WHATSAPP_ANSWERABLE_POSTING_TYPES = ['market_fleet', 'indent'] as const;

/** How Loadsmart appears in the shipper's message log instead of a partner's name. */
export const LOADSMART_DISPLAY_NAME = 'Loadsmart';
/** Who the shipper may see messages to: their own team, their receivers, their drivers and (not
 *  on Loadsmart loads) their own transporters. Loadsmart's partners are never shown. */
export const SHIPPER_VISIBLE_RECIPIENT_KINDS: readonly MessageRecipientKind[] = [
  'shipper_user',
  'receiver',
  'driver',
  'transporter',
];

/** {{shipper_name}} when the shipper's organisation has no name on file. */
export const SHIPPER_NAME_FALLBACK = 'your customer';
/** A template variable can't be empty (MSG91 / Meta reject an empty parameter). */
export const TEMPLATE_VALUE_NOT_GIVEN = '-';
/** Offer values (rupees, reporting time) are written the Indian way, in India time. */
export const INDIAN_NUMBER_LOCALE = 'en-IN';
export const REPORTING_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
};
