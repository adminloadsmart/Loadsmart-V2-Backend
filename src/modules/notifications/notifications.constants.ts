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

/** How long before an e-way bill's expiry its 'load.eway_bill_expiry' alert goes out. */
export const EWAY_BILL_ALERT_LEAD_MS = 30 * 60 * 1000;

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
