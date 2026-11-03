import type { Locale } from '../../shared/i18n/locales';

// External delivery channels a notification can request in addition to the in-app record itself
// (the notification row is always visible via GET /notifications regardless of `channels`).
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

// The mediums a user can switch on/off per notification type in Settings → Notifications:
// in-app (the inbox row itself) plus the external channels above.
export const NOTIFICATION_PREFERENCE_CHANNELS = ['inApp', ...NOTIFICATION_CHANNELS] as const;
export type NotificationPreferenceChannel = (typeof NOTIFICATION_PREFERENCE_CHANNELS)[number];

// How urgent a notification is — product's P1/P2/P3/P4 scale (e.g. LS_N_0001 "Account approved"
// is P2 Action; P4 Digest is for roll-ups like LS_N_0060's morning brief). Set per type in the notification catalog, stored on every notification row, and
// returned by GET /notifications, GET /notifications/:id, and the preferences screen. Rows
// created before severity existed were backfilled as p3_info.
export const NOTIFICATION_SEVERITIES = [
  'p1_critical',
  'p2_action',
  'p3_info',
  'p4_digest',
] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const DEFAULT_NOTIFICATION_SEVERITY: NotificationSeverity = 'p3_info';

// Overall status, derived from the notification's NotificationDeliveryEntity rows (see
// notification.repository.ts's recordDeliveryResult) — 'sent' immediately at creation when
// `channels` is empty (in-app only, nothing to dispatch).
export const NOTIFICATION_STATUSES = [
  'pending',
  'processing',
  'sent',
  'partially_failed',
  'failed',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// Per-channel delivery outcome. No 'retrying' state: a mid-retry job that has failed at least
// once but hasn't exhausted its attempts still reads 'failed' here — a deliberate simplification,
// see the notifications module's plan notes.
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// Inbox card chip — which area of the product a notification is about. Set per type in the
// notification catalog; `general` is the read-time fallback for a type no longer in the catalog.
export const NOTIFICATION_CATEGORIES = [
  'compliance',
  'trip_execution',
  'pod_billing',
  'money',
  'fleet_asset',
  'approvals',
  'drivers',
  'account',
  'digest',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationCategoryOrGeneral = NotificationCategory | 'general';

// How prominent an inbox card's main button is — defaults by severity (see
// notifications.constants.ts), overridable per catalog type.
export const NOTIFICATION_CTA_STYLES = ['danger', 'warning', 'primary', 'secondary'] as const;
export type NotificationCtaStyle = (typeof NOTIFICATION_CTA_STYLES)[number];

// Trip stages LoadService reports to load-alerts.ts: 'in_transit' queues the advance-due card,
// 'reached_delivery_point' LS_N_0031 ('load.vehicle_reached_drop').
export const LOAD_STAGE_HANDOFF_STAGES = ['in_transit', 'reached_delivery_point'] as const;
export type LoadStageHandoffStage = (typeof LOAD_STAGE_HANDOFF_STAGES)[number];

// Events the loadsmart-tracking service publishes that this backend acts on (see
// tracking-events.consumer.ts): the vehicle entered / left the loading point's geofence, entered
// the delivery point's geofence, entered / left any geofence (its own alert), and a rule alert
// opened (only HALT-GPS is acted on — LS_N_0027).
export const TRACKING_EVENT_TYPES = [
  'trip.arrived_at_pickup',
  'trip.departed_pickup',
  'trip.arrived_at_drop',
  'trip.departed_drop',
  'geofence.entered',
  'geofence.exited',
  // LS_N_0028 / LS_N_0029 / LS_N_0030 — tracking decides when; this backend only sends.
  'trip.route_deviation',
  'trip.signal_lost',
  'trip.delivery_late',
  'alert.opened',
] as const;
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

// Driver-app notifications whose text is rebuilt per language (driver-notification-content.ts):
// the sender stores these values as `metadata.messageParams`, so push is rendered in each
// device session's language and the in-app list in the request's Accept-Language. Only names,
// codes, places and numbers go in here — never finished English text.
export interface DriverTenantMessageParams {
  tenantName: string;
}

export interface DriverPodReminderMessageParams {
  loadCode: string;
  vehicleNumber: string | null;
}

export interface DriverLoadAssignedMessageParams {
  /** More than one = the count-only body ("3 loads have been assigned to you"). */
  loadCount: number;
  loadCode: string | null;
  from: string | null;
  to: string | null;
  /** The posting's pickup time (ISO), formatted per language; else `pickupDate` as stored. */
  pickupAt: string | null;
  pickupDate: string | null;
  vehicleNumber: string | null;
  /** Null name with a phone = "Fleet owner" in the reader's language. */
  fleetOwnerName: string | null;
  fleetOwnerPhone: string | null;
}

export interface DriverLoadingContactMessageParams {
  loadCode: string;
  name: string;
  phoneNumber: string;
}

export interface DriverLoadingPointMessageParams {
  loadCode: string;
  pointTitle: string;
  city: string;
}

/** Every driver-app notification type and the values its text is built from. */
export interface DriverMessageParamsByType {
  'driver.account.invited': DriverTenantMessageParams;
  'driver.account.join_approved': DriverTenantMessageParams;
  'driver.account.join_rejected': DriverTenantMessageParams;
  'driver.trip.pod_reminder': DriverPodReminderMessageParams;
  'load.assigned': DriverLoadAssignedMessageParams;
  'load.loading_contact_changed': DriverLoadingContactMessageParams;
  'load.loading_point_changed': DriverLoadingPointMessageParams;
}
export type DriverMessageType = keyof DriverMessageParamsByType;

/** A driver notification's type plus the values its title/body are rendered from. */
export type DriverMessage = {
  [Type in DriverMessageType]: { type: Type; params: DriverMessageParamsByType[Type] };
}[DriverMessageType];

export interface DriverMessageText {
  title: string;
  body: string;
}

/** One title/body builder per driver message type, typed to that type's params. */
export type DriverMessageRenderers = {
  [Type in DriverMessageType]: (
    params: DriverMessageParamsByType[Type],
    locale: Locale,
  ) => DriverMessageText;
};
