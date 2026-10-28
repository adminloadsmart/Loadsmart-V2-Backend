import {
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationCtaStyle,
  NotificationSeverity,
} from './notifications.types';
import { NotificationTypeKey, QuietHoursSetting } from './notifications.interface';
import {
  UNLOADED_LOAD_STATUSES,
  type LoadIssueCategory,
  type LoadStatus,
  type ShortageOrDamageStatus,
} from '../loads/utils/loads.types';

/** Inbox chip text per category (see NOTIFICATION_CATEGORIES). */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategoryOrGeneral, string> = {
  compliance: 'Compliance',
  trip_execution: 'Trip Execution',
  pod_billing: 'POD & Billing',
  money: 'Money',
  fleet_asset: 'Fleet & Asset',
  approvals: 'Approvals',
  drivers: 'Drivers',
  account: 'Account',
  digest: 'Daily Digest',
  general: 'General',
};

/** Main-button style when a catalog type doesn't set its own `ctaStyle`. */
export const DEFAULT_CTA_STYLE_BY_SEVERITY: Record<NotificationSeverity, NotificationCtaStyle> = {
  p1_critical: 'danger',
  p2_action: 'warning',
  p3_info: 'secondary',
  p4_digest: 'primary',
};

/** Severity that still pings during an organisation's quiet hours. */
export const QUIET_HOURS_BYPASS_SEVERITY: NotificationSeverity = 'p1_critical';

/** What GET returns for an organisation that never saved quiet hours (off). */
export const DEFAULT_QUIET_HOURS: QuietHoursSetting = {
  enabled: false,
  startTime: '22:00',
  endTime: '07:00',
};

/** Channels held until quiet hours end. In-app and email are never held. */
export const QUIET_HOURS_HELD_CHANNELS: NotificationChannelName[] = ['push', 'sms', 'whatsapp'];

/** Channels MSG91 delivers to a phone number — skipped for test numbers (isMsg91SkippedNumber). */
export const PHONE_NOTIFICATION_CHANNELS: readonly NotificationChannelName[] = ['sms', 'whatsapp'];

/** Quiet hours are India time, the same fixed zone the daily notification checks use. */
export const INDIA_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IANA zone notification copy and the trip-timing checks show / compute times in. */
export const INDIA_TIME_ZONE = 'Asia/Kolkata';

export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** How long before an e-way bill's expiry its 'load.eway_bill_expiry' alert (LS_N_0025) goes out
 *  — the sheet's last (1 h) step; its 12 h / 4 h steps need a real validity (the placeholder is 2
 *  hours from generation). */
export const EWAY_BILL_ALERT_LEAD_MS = MS_PER_HOUR;

/** LS_N_0027 — when a halt is checked, measured from its start: once past 2 hours, and a second
 *  time only if the same halt crosses 6 hours (at most two alerts per halt). */
export const VEHICLE_HALT_ALERT_STEPS = [
  { step: '2h', afterMs: 2 * MS_PER_HOUR },
  { step: '6h', afterMs: 6 * MS_PER_HOUR },
] as const;
export type VehicleHaltStep = (typeof VEHICLE_HALT_ALERT_STEPS)[number]['step'];

/** LS_N_0027 — the truck's latest position must be this close to where the halt started for it
 *  to still count as the same halt (tracking's HALT-GPS clubbing radius). */
export const VEHICLE_HALT_SAME_SPOT_M = 500;

/** IFSC bank code (first four letters) → display name, for the advance-due card. A code not
 *  listed here is shown as-is. */
export const BANK_NAME_BY_IFSC_PREFIX: Record<string, string> = {
  ICIC: 'ICICI Bank',
  HDFC: 'HDFC Bank',
  SBIN: 'SBI',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Bank',
  PUNB: 'PNB',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank',
  IDIB: 'Indian Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  IDFB: 'IDFC First Bank',
  BKID: 'Bank of India',
  MAHB: 'Bank of Maharashtra',
};

/** A load's reporting time when it has none: Post-a-load loads have a pickup time, Dispatch
 *  Planning loads only a pickup date — this time of day (India time) stands in until loads
 *  capture a real reporting time (LS_N_0016/0017/0021/0022). */
export const DEFAULT_REPORTING_TIME_IST = '10:00';

/** LS_N_0021 — minutes after the reporting time each "not reported" alert goes out (the sheet's
 *  60 min, then every 2 h, 3 alerts at most). From the second one (3 h) org admins are added. */
export const NOT_REPORTED_ALERT_MINUTES = [60, 180, 300];

// Free hours and the detention rate are the company's own (auth.organizations: loading_free_hours,
// unloading_free_hours, detention_rate_per_hour — defaults 4 h / 4 h / ₹500 in the database); a
// customer's free_hours_at_drop overrides the unloading one. See LoadAlertRepository.
/** LS_N_0023/0032 — repeat the detention alert every this many hours while it continues. */
export const DETENTION_REPEAT_HOURS = 4;
/** LS_N_0023/0032 — stop repeating once detention has run this long (12 alerts), so a load left
 *  at a point by mistake doesn't alert every 4 hours forever. */
export const DETENTION_ALERT_MAX_HOURS = 48;
/** LS_N_0033 — how long after the E-POD the trip waits for tracking's exit from the delivery
 *  point before completing without it (no GPS, or the exit was missed). Mirrors how long tracking
 *  keeps following a delivered load (its trip-state.ts DELIVERED_FOLLOW_MS). */
export const TRIP_COMPLETED_FALLBACK_MS = 24 * MS_PER_HOUR;

/** LS_N_0034 — the claim-window reminder goes out this many days before the window closes (the
 *  window itself is the company's: auth.organizations.claim_window_days, default 7). */
export const CLAIM_REMINDER_DAYS_BEFORE = 3;
/** LS_N_0034 — only if the organization row is missing; the real default is the column's
 *  (migration AddShortageClaimsAndDriverProblems). */
export const DEFAULT_CLAIM_WINDOW_DAYS = 7;
/** LS_N_0034 — E-POD cargo conditions that open a claim (a shortage, damage or wet cargo). */
export const CLAIMABLE_SHORTAGE_OR_DAMAGE_STATUSES: readonly ShortageOrDamageStatus[] = [
  'shortage',
  'damage',
  'wet',
  'both',
];

/** LS_N_0039 — hours with no POD in after the vehicle reached the delivery point (or after a
 *  rejection) at which "POD still pending" goes out; the last one goes to org admins only, and
 *  after it the load is left to the daily brief's "PODs pending" count. */
export const POD_PENDING_ALERT_HOURS = [24, 48, 72];

/** LS_N_0037 — driver-reported issues that alert (P1, through quiet hours). Breakdown has its own
 *  alert (LS_N_0054); traffic jams and rest stops are routine and stay on the load timeline. */
export const DRIVER_PROBLEM_ALERT_CATEGORIES: readonly LoadIssueCategory[] = [
  'accident',
  'road_blocked',
  'police_rto_check',
  'strike',
  'weather',
  'other',
];

/** LS_N_0017 — escalate to org admins this long after a blocked assignment, and don't alert the
 *  same blocked vehicle again within it (a user retrying the assignment). */
export const ASSIGNMENT_BLOCK_ALERT_WINDOW_MS = MS_PER_HOUR;

/** tracking.events listener (tracking-events.consumer.ts): entries read per call, how long a read
 *  waits for new ones, when another instance's unacknowledged entry is taken over, how often a
 *  failing handler is retried, how long a handled event id is remembered (dedupe), and the pause
 *  after a Redis error. */
export const TRACKING_EVENTS_BATCH_SIZE = 50;
export const TRACKING_EVENTS_BLOCK_MS = 5000;
export const TRACKING_EVENTS_CLAIM_IDLE_MS = 60_000;
export const TRACKING_EVENTS_MAX_ATTEMPTS = 5;
export const TRACKING_EVENT_SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const TRACKING_EVENTS_ERROR_BACKOFF_MS = 5000;

/** How late a scheduled trip-timing alert may still go out — so a backlog (first deploy, a
 *  missed run) never sends stale alerts. */
export const TRIP_TIMING_GRACE_MINUTES = 60;

/** LS_N_0050 — gross vehicle weight an LMV licence still covers (licence-check.ts). */
export const LMV_MAX_GROSS_WEIGHT_KG = 7500;

/** LS_N_0050 — Sarathi class-of-vehicle codes that cover a transport (goods) vehicle over
 *  LMV_MAX_GROSS_WEIGHT_KG: TRANS since 1994, the older classes on older licences. */
export const TRANSPORT_LICENCE_CLASSES: readonly string[] = [
  'TRANS',
  'MGV',
  'HGMV',
  'HMV',
  'HTV',
  'HPMV',
];

/** LS_N_0060 — trip stages the morning brief counts as "on road" (left the plant, not yet
 *  delivered). */
export const DAILY_BRIEF_RUNNING_STATUSES: readonly LoadStatus[] = [
  'in_transit_unloading',
  'reached_unloading',
];

/** LS_N_0060 — at the unloading point and not yet delivered; the E-POD is what moves it to
 *  delivered. A rejected E-POD not yet re-uploaded counts too (LS_N_0039 hands both to this
 *  count after 72 h). */
export const DAILY_BRIEF_POD_PENDING_STATUS: LoadStatus = 'reached_unloading';

/** LS_N_0059/0060 — a vehicle with a load in any other stage still has a trip in hand. */
export const TRIP_FINISHED_LOAD_STATUSES: readonly LoadStatus[] = [
  ...UNLOADED_LOAD_STATUSES,
  'closed',
];

/** LS_N_0057 — how far back the average service/breakdown cost looks. */
export const MAINTENANCE_COST_AVERAGE_MONTHS = 12;

/** LS_N_0058 — the tyres queue's next step, as the alert words it. */
export const TYRE_ACTION_LABELS: Record<string, string> = {
  retread: 'retread',
  new_tyre: 'replacement',
  scrap: 'scrapping',
};

/** Notification types whose path is logged step by step (utils/notification-trace.ts) → the sheet
 *  code every log line starts with, so `grep LS_N_0006` on a server finds the whole trail. */
export const TRACED_NOTIFICATION_TYPES: Partial<Record<NotificationTypeKey, string>> = {
  'user.access_changed': 'LS_N_0006',
  'user.access_removed': 'LS_N_0007',
  'user.access_removed_confirmation': 'LS_N_0007',
};

/** Web-app routes an email's button can open — the frontend's own pages (its app/ folder). Built
 *  into the full `cta_url` link by utils/app-url.ts. */
export const FRONTEND_PATHS = {
  root: '/',
  home: '/home',
  login: '/auth/login',
  fleet: '/fleet',
  vehicle: (vehicleId: string) => `/fleet/${vehicleId}`,
  load: (loadId: string) => `/loads/${loadId}`,
} as const;

/** Metadata key — and email template variable — carrying the email button's full link. */
export const EMAIL_CTA_URL_KEY = 'cta_url';
