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

/** A load display code inside typed text ("LOAD-1008"); its digits are never a rate. */
export const LOAD_CODE_IN_TEXT_PATTERN = /\bLOAD-\d+\b/gi;
/** A message that is only a load code — the user naming a row of their "Choose load" list. */
export const BARE_LOAD_CODE_PATTERN = /^\s*(LOAD-\d+)\s*$/i;

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
  schedules: 'whatsapp-schedules',
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

/**
 * A value sent without a swipe goes to the load we last asked for it ("LOAD-1008: Send the truck
 * number") when that ask is this recent and no other waiting load was asked for it in that time.
 */
export const LAST_ASK_WINDOW_MS = 4 * 60 * 60 * 1000;

/** A tap (or list pick) on a message whose WAMID hasn't come yet: MSG91 returns only a request
 *  id on send, and its delivery report with the WAMID can reach us after the user's tap (seen
 *  20 Nov: the report came ~6 min late). The tap waits up to `windowMs` from when we stored it,
 *  looked at again every `retryMs`, before it is given up with a reply. */
export const TAPPED_MESSAGE_WAIT = { windowMs: 5 * 60 * 1000, retryMs: 30 * 1000 } as const;

/** Which typed value each prompt asks for (a message_log row's `kind`). */
export const VALUE_ASKED_BY_PROMPT = {
  rate_request: 'rate',
  // The shipper's counter price is read as a typed rate.
  price_request: 'rate',
  dispatch_request: 'dispatch',
  slip_request: 'slip',
} as const;

/** Key in message_log.variables marking a load info text that also asks for a value
 *  ("Done. Send the truck number if you have it."). */
export const ASKS_FOR_VARIABLE = 'asksFor';

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
/** load_route_changes.reason when the contracted transporter rejects an indent on WhatsApp. */
export const INDENT_REJECTED_ON_WHATSAPP_REASON = 'Rejected by the transporter on WhatsApp';

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
  price_request: null,
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
  loadNotices: 'system:load-notices',
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

// ---- Load notices on WhatsApp (catalog LS_N_0069, 0107–0130): memo, confirmations, papers,
// payments and the original POD.

/** The daily original POD follow-up (LS_N_0115 reminders, LS_N_0116 penalty), 10:00 IST. */
export const ORIGINAL_POD_FOLLOW_UP_JOB = 'original-pod-follow-ups';
export const ORIGINAL_POD_FOLLOW_UP_CRON = '0 10 * * *';
export const ORIGINAL_POD_FOLLOW_UP_TIME_ZONE = 'Asia/Kolkata';
/** LS_N_0115 reminders, in days before the original POD is due: the catalog's "day 10, day 18
 *  and day 20" for a 20-day due date, kept relative to the settings' due days. */
export const ORIGINAL_POD_REMINDER_DAYS_BEFORE_DUE = [10, 2, 0] as const;
/** LS_N_0116: the day after the due date, then every 7 days until the original is received. */
export const ORIGINAL_POD_PENALTY_REPEAT_DAYS = 7;
/** Original POD tracker statuses the partner is still chased in (not sent yet, not reachable). */
export const ORIGINAL_POD_CHASED_STATUSES = ['yet_to_dispatch', 'not_contactable'] as const;
/** A follow-up already sent within this window is not sent again (one per day, even if the job
 *  re-runs). */
export const FOLLOW_UP_DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000;

/** {{payment_head}} on LS_N_0112, per Loadsmart partner payment type. */
export const PARTNER_PAYMENT_HEADS = { advance: 'Advance', balance: 'Balance' } as const;

/** {{issue_type}} on LS_N_0114, per the POD's shortage / damage value. */
export const POD_ISSUE_LABELS: Record<string, string> = {
  shortage: 'a shortage',
  damage: 'damage',
  wet: 'wet goods',
  both: 'shortage and damage',
  pilferage: 'pilferage',
};

/** {{pod_due_date}}: "25 Nov", India time. */
export const DUE_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
};

/** The load stage a memo waits at for the shipper's acceptance (accepting it moves the load to
 *  Truck assigned). */
export const MEMO_WAITING_LOAD_STATUS = 'bids_received';

/** A load bid still open for the shipper to accept. */
export const LIVE_BID_STATUS = 'received';
/** {{truck_type}} when the posting names no truck length. */
export const TRUCK_LABEL_FALLBACK = 'Truck';
/** LS_N_0103: the first bid at once, then at most one roll-up per this interval. */
export const BIDS_ROLLUP_INTERVAL_MS = 30 * 60 * 1000;
/** The delayed roll-up job on the whatsapp-schedules queue, one per load (jobId prefix + load id;
 *  BullMQ job ids must not contain ':'). */
export const BIDS_ROLLUP_JOB = 'bids-received-rollup';
export const BIDS_ROLLUP_JOB_ID_PREFIX = 'bids-rollup-';
/** LS_N_0069 again to the shipper when this much of the load memo's time is left (catalog: "P1
 *  when 20 minutes are left"). */
export const MEMO_REMINDER_BEFORE_EXPIRY_MS = 20 * 60 * 1000;
/** The delayed memo reminder on the whatsapp-schedules queue, one per memo version. */
export const MEMO_REMINDER_JOB = 'memo-expiry-reminder';
export const MEMO_REMINDER_JOB_ID_PREFIX = 'memo-reminder-';
/** The Loadsmart sourcing status once Loadsmart's bid won the load (its partner is on the truck). */
export const LOADSMART_WON_SOURCING_STATUS = 'won';
