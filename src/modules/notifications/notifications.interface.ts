import { PaginationInput } from '../../shared/utils/pagination';
import {
  LoadStageHandoffStage,
  TrackingEventType,
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationCtaStyle,
  NotificationPreferenceChannel,
  NotificationSeverity,
} from './notifications.types';
import { NotificationEntity } from './notifications.entity';
import type { AssignmentComplianceSubject } from '../loads/utils/loads.types';

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
  /** False = the recipient turned in-app off for this type: the row is still created (for the
   *  external deliveries) but never appears in their inbox. Defaults to true. */
  showInApp?: boolean;
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

/** One row of the caller's own Settings → Notifications screen. */
export interface MyNotificationPreferenceView {
  key: string;
  label: string;
  description: string | null;
  severity: NotificationSeverity;
  category: NotificationCategoryOrGeneral;
  categoryLabel: string;
  /** Mediums this type can use — fixed per type; any other toggle must be disabled. */
  supportedChannels: NotificationPreferenceChannel[];
  /** The caller's effective on/off per medium (unsupported ones are always false). */
  preferences: ChannelPreferenceFlags;
  /** True once the caller saved their own choice for this type; false = still on the
   *  organisation's setting / the type's defaults. */
  isCustomized: boolean;
}

/** One item of PUT /notifications/preferences (the caller's own). `inApp` omitted = unchanged. */
export interface UpdateMyNotificationPreferenceInput {
  key: string;
  channels: Omit<ChannelPreferenceFlags, 'inApp'> & { inApp?: boolean };
}

/** On/off per medium for one notification type — a user's effective preference. */
export interface ChannelPreferenceFlags {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  whatsapp: boolean;
}

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
  | { kind: 'pod_uploaded'; tenantId: string; loadId: string; at: Date }
  /** LS_N_0022 — the vehicle reached the loading point: the manual "At plant" step (driver app or
   *  staff) or tracking's geofence entry, whichever came first. */
  | { kind: 'at_plant'; tenantId: string; loadId: string; at: Date }
  /** LS_N_0024 — loading confirmed (all mandatory documents in). `confirmedBy` is the assigned
   *  driver (driver app) or a staff user. */
  | {
      kind: 'loading_confirmed';
      tenantId: string;
      loadId: string;
      at: Date;
      confirmedBy: LoadPersonRef;
      ewayBillExpiresAt: Date | null;
    }
  /** LS_N_0016 — a vehicle (and driver) went onto the load: market Load Assignment, own-fleet
   *  Dispatch Planning or own-fleet Post a load. Whether the masters had the vehicle / driver to
   *  check comes from the assignment-time compliance check. */
  | {
      kind: 'assigned';
      tenantId: string;
      loadId: string;
      at: Date;
      vehicleChecked: boolean;
      driverChecked: boolean;
    }
  | AssignmentBlockedEvent;

/** Who did something on a load: the assigned driver (driver app) or a staff user. */
export type LoadPersonRef = { driverId: string } | { userId: string };

/** LS_N_0017 — an assignment was refused because the vehicle or driver has an expired document.
 *  Nothing was saved, so the event carries what the message needs. A market Load Assignment has
 *  its `loadId`; own-fleet Dispatch Planning its `requisitionId`; own-fleet Post a load neither
 *  (the posting was never created) — its cities and pickup time instead. */
export interface AssignmentBlockedEvent {
  kind: 'assignment_blocked';
  tenantId: string;
  at: Date;
  loadId?: string | null;
  requisitionId?: string | null;
  vehicleNumber: string;
  vehicleId: string | null;
  driverId: string | null;
  driverName: string | null;
  subject: AssignmentComplianceSubject;
  docType: string;
  expiryDate: string;
  transporterName?: string | null;
  originCity?: string | null;
  destinationCity?: string | null;
  pickupAt?: Date | null;
}

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
  /** The name typed at Load Assignment, else the linked driver master's. */
  driverName: string | null;
  driverPhone: string | null;
  createdBy: string | null;
  originCity: string | null;
  destinationCity: string | null;
  /** Lorry receipt (E-LR) number — optional even once the E-LR file is uploaded. */
  elrNumber: string | null;
  /** The E-LR file is on the load. */
  hasLorryReceipt: boolean;
  /** Loading documents on the load: invoice, e-way bill, E-LR, weighing slip and photos. */
  documentCount: number;
  /** Cargo planned on this truck (sum of its cargo lines), else its planned capacity. */
  cargoTonnes: string | null;
  /** The loading point's coordinates — "last seen N km away" (LS_N_0021). */
  originLat: number | null;
  originLng: number | null;
  /** The loading point's arrival geofence in metres; null = the default (LS_N_0027). */
  originGeofenceRadiusM: number | null;
  /** Master points the trip's geofences link to (LS_N_0027): the pickup loading point, and the
   *  drop — a customer delivery point, or a loading point for a posted load. */
  originLoadingPointId: string | null;
  destinationDeliveryPointId: string | null;
  destinationLoadingPointId: string | null;
  /** The delivery point's coordinates and geofence — a halt inside it is not alerted (LS_N_0027). */
  destinationLat: number | null;
  destinationLng: number | null;
  destinationGeofenceRadiusM: number | null;
  /** When the vehicle reached the loading point (LS_N_0022/0023). */
  atPlantAt: Date | null;
  /** Requisition pickup date (YYYY-MM-DD) — Dispatch Planning loads. */
  pickupDate: string | null;
  /** Posting pickup time — Post-a-load loads. */
  pickupAt: Date | null;
}

/** A requisition as LS_N_0017 shows it when an own-fleet dispatch was blocked. */
export interface RequisitionAlertSummary {
  code: string;
  /** "Ludhiana to Bhiwandi"; null when either end has no city. */
  route: string | null;
  pickupDate: string;
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

/** One entry of the tracking service's `tracking.events` stream (tracking-events.consumer.ts). */
export interface TrackingEvent {
  /** The stream entry id (Redis). */
  streamId: string;
  /** Tracking's outbox id — stable across a re-relay, so it's the dedupe key. */
  eventId: string;
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
}

/** What this backend does for each tracking event type it acts on. */
export type TrackingEventHandlers = Partial<
  Record<TrackingEventType, (event: TrackingEvent) => Promise<void>>
>;
