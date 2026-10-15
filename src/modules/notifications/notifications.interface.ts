import { PaginationInput } from '../../shared/utils/pagination';
import {
  LoadStageHandoffStage,
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationCtaStyle,
  NotificationSeverity,
} from './notifications.types';
import { NotificationEntity } from './notifications.entity';

/** Destination the caller supplies for each requested channel — this module owns no
 *  contact/token registry of its own, so these are taken as-is (see notifications.service.ts). */
export interface NotificationDestinations {
  email?: string;
  phoneNumber?: string;
  pushToken?: string;
  whatsappNumber?: string;
}

/**
 * The shape NotificationsService.send() takes. There is no HTTP endpoint for this — it's called
 * in-process by other modules once wired (nothing calls it yet in this change), so this is a
 * plain TS interface, not a zod-validated request body.
 */
export interface CreateNotificationInput {
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  channels?: NotificationChannelName[];
  destinations?: NotificationDestinations;
  metadata?: Record<string, unknown> | null;
  /** Defaults to p3_info when omitted (catalog-driven sends always pass their type's severity). */
  severity?: NotificationSeverity;
  /** Hold a channel's delivery this long (e.g. until the org's quiet hours end — see
   *  quiet-hours.ts). The in-app row itself is always created immediately. */
  channelDelaysMs?: Partial<Record<NotificationChannelName, number>>;
}

export interface ListNotificationsInput extends PaginationInput {
  unreadOnly?: boolean;
  severity?: NotificationSeverity;
}

/** Display-only fields every inbox notification carries, derived from its catalog type on read
 *  (see utils/notification-presenter.ts) — never stored. */
export interface NotificationPresentation {
  category: NotificationCategoryOrGeneral;
  categoryLabel: string;
  ctaStyle: NotificationCtaStyle;
  bypassesQuietHours: boolean;
}

export type PresentedNotification = NotificationEntity & NotificationPresentation;

/** An organisation's quiet hours — 24-hour 'HH:MM', India time; the window may wrap midnight. */
export interface QuietHoursSetting {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

/** What LoadService reports after its own writes — see load-alerts.ts. */
export type LoadEvent =
  | { kind: LoadStageHandoffStage; tenantId: string; loadId: string; at: Date }
  | {
      kind: 'eway_bill_generated';
      tenantId: string;
      loadId: string;
      generatedAt: Date;
      expiresAt: Date;
    }
  | { kind: 'pod_uploaded'; tenantId: string; loadId: string; at: Date };

/** Queues the notification(s) for a load event — never throws. */
export type LoadEventNotifier = (event: LoadEvent) => Promise<void>;

/** One load as the load-event notifications need it (load-alert.repository.ts). */
export interface LoadAlertSnapshot {
  code: string;
  status: string;
  sourceType: string;
  vehicleNumber: string | null;
  transporterName: string | null;
  transporterBankAccountNumber: string | null;
  transporterBankIfsc: string | null;
  freightType: string | null;
  freightValue: string | null;
  plannedCapacityTonnes: string | null;
  advancePercentage: string | null;
  advancePaidAt: Date | null;
  ewayBillNumber: string | null;
  ewayBillGeneratedAt: Date | null;
  podStatus: string | null;
  podReceiverName: string | null;
  podQuantityReceived: string | null;
  numberOfTonnesShort: string | null;
  shortageOrDamage: string | null;
  /** "Ludhiana to Bhiwandi"; null when either end has no city. */
  route: string | null;
  consigneeName: string | null;
}

/** The earliest planned trip on a vehicle — the "cannot be dispatched" card's first affected
 *  load. */
export interface NextPlannedTrip {
  loadId: string;
  loadCode: string;
  /** "Ludhiana to Bhiwandi"; null when either end has no city. */
  route: string | null;
  pickupDate: string;
  transporterName: string | null;
}
