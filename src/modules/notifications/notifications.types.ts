// External delivery channels a notification can request in addition to the in-app record itself
// (the notification row is always visible via GET /notifications regardless of `channels`).
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

// How urgent a notification is — product's P1/P2/P3 scale (e.g. LS_N_0001 "Account approved" is
// P2 Action). Set per type in the notification catalog, stored on every notification row, and
// returned by GET /notifications, GET /notifications/:id, and the preferences screen. Rows
// created before severity existed were backfilled as p3_info.
export const NOTIFICATION_SEVERITIES = ['p1_critical', 'p2_action', 'p3_info'] as const;
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
