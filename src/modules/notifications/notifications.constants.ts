import {
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationCtaStyle,
  NotificationSeverity,
} from './notifications.types';
import { QuietHoursSetting } from './notifications.interface';

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

/** Quiet hours are India time, the same fixed zone the daily notification checks use. */
export const INDIA_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IANA zone notification copy and the trip-timing checks show / compute times in. */
export const INDIA_TIME_ZONE = 'Asia/Kolkata';

export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

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

/** LS_N_0022/0023 — free loading hours at the plant before detention starts, and the detention
 *  rate. Fixed placeholders until detention terms are configurable (org or customer contract). */
export const FREE_LOADING_HOURS = 4;
export const DETENTION_RATE_PER_HOUR = 500;
/** LS_N_0023 — repeat the detention alert every this many hours while it continues. */
export const DETENTION_REPEAT_HOURS = 4;
/** LS_N_0023 — stop repeating once detention has run this long (12 alerts), so a load left "At
 *  plant" by mistake doesn't alert every 4 hours forever. */
export const DETENTION_ALERT_MAX_HOURS = 48;

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
