import { PaginationInput } from '../../shared/utils/pagination';
import {
  LoadStageHandoffStage,
  TrackingEventType,
  NotificationCategory,
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationCtaStyle,
  NotificationPreferenceChannel,
  NotificationSeverity,
} from './notifications.types';
import { NotificationEntity } from './notifications.entity';
import type { NotificationPreferenceEntity } from './entities/notification-preference.entity';
import type { UserNotificationPreferenceEntity } from './entities/user-notification-preference.entity';
import type {
  AssignmentComplianceSubject,
  PodReviewDecision,
  LoadIssueCategory,
} from '../loads/utils/loads.types';
import type { DriverLicenseEndorsement } from '../driver/drivers.types';
import type { VehicleDocumentTypeWithExpiry } from '../masters/vehicle/vehicle.type';
import type { UserEntity } from '../auth/entities/user.entity';
import type { LoadIssueReportEntity } from '../loads/entities/load-issue-report.entity';
import type { LoadAlertRepository } from './load-alert.repository';
import type { ScheduledAlertRepository } from './scheduled-alert.repository';
import type { MasterKind, NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import type { GeofenceArea } from '../geofences/utils/geofence.geo';
import type { GeofenceTransitionNotice, LatLng } from '../geofences/utils/geofence.interface';
import type { GeofenceType, HaltExpectedGeofenceType } from '../geofences/utils/geofence.types';
import type { AuthRepository } from '../auth/auth.repository';
import type { AuthService } from '../auth/auth.service';
import type { NotificationsService } from './notifications.service';

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

/** A type's inbox chip — 'general' for a type no longer in the catalog. */
export type NotificationCategoryChip = Pick<NotificationPresentation, 'category' | 'categoryLabel'>;

/** The catalog entry fields the inbox display reads. */
export interface CatalogDisplayFields {
  category?: NotificationCategory;
  ctaStyle?: NotificationCtaStyle;
}

/** Where a user's effective mediums for one type come from, most specific first. */
export interface ChannelPreferenceSources {
  userPreference: UserNotificationPreferenceEntity | null;
  organizationPreference: NotificationPreferenceEntity | null;
  defaultChannels: NotificationChannelName[];
}

/** One saved preference row: a type and its on/off per medium. */
export interface UserPreferenceItem {
  notificationTypeId: string;
  channels: ChannelPreferenceFlags;
}

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
  /** LS_N_0040/0041 — staff rejected or accepted the pending E-POD at `at` (its podReviewedAt). */
  | {
      kind: 'pod_reviewed';
      tenantId: string;
      loadId: string;
      decision: PodReviewDecision;
      at: Date;
    }
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
  /** The transporter's balance was paid (LS_N_0038 then has no balance to name). */
  balancePaidAt: Date | null;
  ewayBillNumber: string | null;
  ewayBillGeneratedAt: Date | null;
  podStatus: string | null;
  /** The last E-POD review — when, by which staff user, and the reason if it was rejected
   *  (LS_N_0039/0040/0041). */
  podReviewedAt: Date | null;
  podReviewedBy: string | null;
  podRejectionReason: string | null;
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
  /** When the vehicle reached the delivery point (LS_N_0031/0032). */
  reachedDeliveryPointAt: Date | null;
  /** When the E-POD was first uploaded — unloading confirmed (LS_N_0033). */
  deliveredAt: Date | null;
  /** When the vehicle left the delivery point's geofence (LS_N_0032/0033); null without GPS. */
  departedDropAt: Date | null;
  /** Requisition's expected delivery date (YYYY-MM-DD) — the promised date (LS_N_0031). Post-a-
   *  load loads have none. */
  promisedDeliveryDate: string | null;
  /** The customer's own free unloading hours; null → the company's (LS_N_0031/0032). */
  customerFreeHoursAtDrop: number | null;
  /** Post-a-load "deliver by" — the promised time for a posted load (LS_N_0031). */
  postingDeliverByAt: Date | null;
  /** Value of the cargo per MT, from the requisition or posting — a shortage's value at risk
   *  (LS_N_0034). */
  cargoValuePerTonne: string | null;
}

/** The company's detention terms (auth.organizations) — LS_N_0022/0023/0031/0032. */
export interface DetentionTerms {
  loadingFreeHours: number;
  unloadingFreeHours: number;
  ratePerHour: number;
}

/** LS_N_0050 — a load's driver, vehicle and cargo as the licence check sees them. */
export interface LicenceCheckRow {
  /** Null when the driver isn't in the masters (a typed-in market driver nobody added). */
  driverId: string | null;
  driverName: string | null;
  /** Driver master endorsement codes, e.g. ['hazmat']. */
  endorsements: DriverLicenseEndorsement[];
  /** Latest Sarathi class-of-vehicle list, e.g. "LMV, HGMV"; null when never checked. */
  licenceClass: string | null;
  vehicleNo: string | null;
  /** Vahan's passing weight; null when the vehicle isn't in the masters or has none. */
  grossVehicleWeightKg: number | null;
  /** Products on the load classified hazardous in the product master. */
  hazardousProducts: string[];
}

/** LS_N_0050 — what a licence doesn't cover (licence-check.ts). */
export interface LicenceMismatch {
  /** Vehicle over LMV_MAX_GROSS_WEIGHT_KG and no transport class on the licence. */
  needsTransportClass: boolean;
  /** Hazardous cargo and no 'hazmat' endorsement. */
  needsHazmatEndorsement: boolean;
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

/** A tracking-driven arrival: at the loading point or the unloading (delivery) point. */
export type TrackedArrival = 'reached_loading' | 'reached_unloading';

export type OriginCoordinates = Pick<LoadAlertSnapshot, 'originLat' | 'originLng'>;
export type DestinationCoordinates = Pick<LoadAlertSnapshot, 'destinationLat' | 'destinationLng'>;

/** A load a sweep found, by id and tenant. */
export interface LoadRef {
  loadId: string;
  tenantId: string;
}

/** LS_N_0021 — a load not at the loading point yet, with its reporting time. */
export interface AssignedLoadDue extends LoadRef {
  reportingAt: Date;
}

/** LS_N_0039 — a load waiting on a POD, since it reached the drop or its E-POD was rejected. */
export interface PodPendingLoad extends LoadRef {
  since: Date;
}

/** AssignedLoadDue as Postgres returns it (the computed time may come back as a string). */
export interface RawAssignedLoadDueRow extends LoadRef {
  reportingAt: Date | string;
}

/** PodPendingLoad as Postgres returns it. */
export interface RawPodPendingRow extends LoadRef {
  since: Date | string;
}

/** A detention candidate as Postgres returns it (LoadAlertRepository). */
export interface RawDetentionRow {
  loadId: string;
  tenantId: string;
  arrivedAt: Date | string;
  freeHours: number | string;
}

/** A load in detention, as the trip-timing sweep needs it (LS_N_0023/0032). */
export interface DetentionCandidate {
  loadId: string;
  tenantId: string;
  /** When the vehicle reached the point — the clock's start. */
  arrivedAt: Date;
  freeHours: number;
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

/** LS_N_0059/0060 — an own-fleet vehicle in service with no trip in hand
 *  (ScheduledAlertRepository.findFreeVehicles). */
export interface FreeVehicle {
  tenantId: string;
  vehicleId: string;
  vehicleNo: string;
  /** The latest delivery/close of any of its loads, else when the vehicle was added. */
  lastTripAt: Date;
  fixedCostMonthly: string | null;
  emiAmount: string | null;
}

/** A free vehicle idle past IDLE_DAYS, as LS_N_0059 ranks it. */
export interface IdleVehicle extends FreeVehicle {
  /** India date of lastTripAt (YYYY-MM-DD). */
  lastTripDate: string;
  idleDays: number;
}

/** LS_N_0060 — one organisation's counts for the morning brief. */
export interface DailyBriefCounts {
  /** Trips on the road (left the plant, not yet delivered). */
  running: number;
  /** At the unloading point without an E-POD, or delivered with the E-POD rejected. */
  pods: number;
  /** Vehicles with an expired dispatch document. */
  blocked: number;
}

/** An active organisation user with their effective permissions (role ∪ direct grants). */
export interface OrganizationUserAccess {
  id: string;
  role: string;
  permissions: string[];
}

/** LS_N_0056/0057 — an own-fleet vehicle with a service record to measure from. */
export interface ServiceDueVehicle {
  tenantId: string;
  vehicleId: string;
  vehicleNo: string;
  odometerKm: number;
  lastServiceOdometerKm: number;
  lastServiceDate: string | null;
  /** The vehicle's own service interval; null → DEFAULT_SERVICE_INTERVAL_KM. */
  intervalKm: number | null;
}

/** Org-wide average cost of closed service and breakdown jobs (LS_N_0057). */
export interface MaintenanceCostAverages {
  service: number | null;
  breakdown: number | null;
}

/** Pickup dates a planned-trip count covers: on/after `fromDate` (after it when
 *  `excludeFromDate`), up to and including `toDate` when given. */
export interface PlannedTripWindow {
  fromDate: string;
  toDate?: string;
  excludeFromDate?: boolean;
}

/** LS_N_0049 — upcoming (not yet started) trips a driver is rostered on. */
export interface DriverUpcomingTrips {
  upcoming: number;
  pickupToday: boolean;
}

/** LS_N_0047/0048 — a vehicle document with an expiry date. */
export interface ExpiringVehicleDocument {
  id: string;
  tenantId: string;
  vehicleId: string;
  vehicleNo: string;
  documentType: VehicleDocumentTypeWithExpiry;
  expiryDate: string;
  /** Days from the check date to expiry (negative once expired). */
  daysLeft: number;
}

/** LS_N_0049 — a driver's licence, once per organisation the driver belongs to. */
export interface ExpiringDriverLicence {
  driverId: string;
  tenantId: string;
  driverName: string;
  licenceNumber: string | null;
  expiryDate: string;
  daysLeft: number;
}

/** LS_N_0058 — a tyre's km run and its share of its Record Tyre Maintenance entry's cost. */
export interface TyreCost {
  tyreId: string;
  /** Removal odometer (else the vehicle's current one) minus the fitted odometer. */
  kmRun: number | null;
  /** The entry's total ÷ the tyres it fitted; null when fitted without a costed entry. */
  cost: number | null;
}

/** A tyre in the maintenance tyres queue (TyreService.listQueue), as LS_N_0058 reads it. */
export interface TyreQueueItem {
  tyreId: string;
  vehicle: { id: string; registrationNumber: string };
  position: string;
  nextStep: string;
  currentTreadMm?: number;
}

/** The maintenance tyres queue of one tenant. */
export interface TyreQueue {
  items: TyreQueueItem[];
}

/** One job type's average cost, as ScheduledAlertRepository reads it (numeric → string). */
export interface MaintenanceJobCostAverageRow {
  jobType: string;
  average: string | null;
}

/** This tenant's users holding a permission (AuthRepository.listUsersWithPermission). */
export type UsersWithPermissionLookup = (
  tenantId: string,
  permission: string,
) => Promise<UserEntity[]>;

/** LS_N_0055 back-in-service resolver (back-in-service.ts). */
export interface BackInServiceResolverDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  listUsersWithPermission: UsersWithPermissionLookup;
}

/** LS_N_0056/0057 service checks (service-alerts.ts). */
export interface ServiceAlertsDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  triggers: NotificationTriggers;
  listUsersWithPermission: UsersWithPermissionLookup;
}

/** LS_N_0058 tyre check (tyre-alerts.ts). */
export interface TyreAlertsDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  triggers: NotificationTriggers;
  listTyreQueue: (tenantId: string) => Promise<TyreQueue>;
}

/** LS_N_0047/0048/0049 document and licence checks (vehicle-document-alerts.ts). */
export interface VehicleDocumentAlertsDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  triggers: NotificationTriggers;
  /** The "cannot be dispatched" card's first affected trip. */
  loadAlertRepository: LoadAlertRepository;
  listUsersWithPermission: UsersWithPermissionLookup;
}

/** LS_N_0059/0060 digests (digests.ts). */
export interface DigestsDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  triggers: NotificationTriggers;
}

/** Job data on the 'notification-schedules' queue — `today` (YYYY-MM-DD) runs a check for a
 *  specific date; otherwise it's today in India time. */
export interface NotificationScheduleJobData {
  today?: string;
}

/** A daily sweep sharing the 9:00 IST tick, returning its counts by name. */
export interface DailyNotificationSweep {
  runDaily(today: string): Promise<Record<string, number>>;
}

/** A master record (vehicle, driver, loading point, product, customer) for LS_N_0009–0011. */
export interface MasterApprovalEvent {
  kind: MasterKind;
  tenantId: string;
  recordId: string;
  masterValue: string;
  createdBy: string | null;
}

/** A recorded Vahan verification result for a vehicle (LS_N_0012). */
export interface VahanResultEvent {
  tenantId: string;
  vehicleId: string;
  vehicleNo: string;
  createdBy: string | null;
  verificationStatus: string;
}

/** What the masters, driver and customers services call after their own create/approve logic
 *  (master-approvals.ts) — only queues a trigger and never throws. */
export interface MasterApprovalNotifier {
  /** Call after a record is created — no-op unless it's actually waiting for approval. */
  requested(event: MasterApprovalEvent & { pending: boolean }): Promise<void>;
  /** Call after a pending record is approved. */
  approved(event: MasterApprovalEvent & { approvedBy: string }): Promise<void>;
  /** Call after a pending record is rejected (LS_N_0011). */
  rejected(event: MasterApprovalEvent & { rejectedBy: string; reason: string }): Promise<void>;
  /** Call after a Vahan verification result is recorded for a vehicle (LS_N_0012) — no-op
   *  unless it's a failure (not_found / manual_review). */
  vahanResult(event: VahanResultEvent): Promise<void>;
}

/** LS_N_0009–0011 context resolvers (master-approvals.ts). */
export interface MasterApprovalResolverDeps {
  scheduledAlertRepository: ScheduledAlertRepository;
  getUserFullName(userId: string): Promise<string | null>;
  getUserRoleName(userId: string): Promise<string | null>;
  getEffectivePermissions(userId: string): Promise<string[]>;
}

export type NotificationCatalog = typeof NOTIFICATION_CATALOG;

/** Every notification type in NOTIFICATION_CATALOG — the only types a trigger can enqueue. */
export type NotificationTypeKey = keyof NotificationCatalog & string;

/** The context a type's buildContent takes — what enqueue checks `context` against. */
export type NotificationContextOf<K extends NotificationTypeKey> =
  NotificationCatalog[K] extends NotificationTypeDefinition<infer TContext> ? TContext : never;

/** One job on the 'notification-triggers' queue (notification-triggers.ts). */
export interface NotificationTriggerPayload {
  type: NotificationTypeKey;
  tenantId: string;
  context: unknown;
  /** Set on the one reminder job scheduled for a type with `reminderAfterMs`. */
  isReminder?: boolean;
}

/** Per-type "is this still worth sending?" checks, run by the trigger worker right before each
 *  send (initial and reminder) — e.g. LS_N_0003 only while the document is still invalid. A type
 *  without one is always sent. Supplied by composition-root.ts, since the checks read other
 *  modules' state. */
export type NotificationRelevanceChecks = {
  [K in NotificationTypeKey]?: (
    tenantId: string,
    context: NotificationContextOf<K>,
  ) => Promise<boolean>;
};

/** Per-type hook that finalises the context right before sending — e.g. LS_N_0006 turns
 *  "capabilities before the change" into the actual added/removed lists. Returning null means
 *  there's nothing worth sending (e.g. the changes cancelled out). Supplied by
 *  composition-root.ts, like relevance checks. */
export type NotificationContextResolvers = {
  [K in NotificationTypeKey]?: (
    tenantId: string,
    context: NotificationContextOf<K>,
  ) => Promise<NotificationContextOf<K> | null>;
};

/** The catalog entry fields that decide how a trigger is queued (collapsed, delayed, reminded). */
export interface NotificationTriggerOptions {
  frequency?: 'always' | 'once_per_tenant';
  dedupeKey?: (context: unknown) => string;
  reminderAfterMs?: number;
  debounceMs?: number;
  delayMs?: number;
}

export interface NotificationEnqueueOptions {
  /** Send this long from now instead of immediately (needs an occurrence key — dedupeKey). */
  delayMs?: number;
}

export interface NotificationTriggers {
  enqueue<K extends NotificationTypeKey>(
    type: K,
    tenantId: string,
    context: NotificationContextOf<K>,
    options?: NotificationEnqueueOptions,
  ): Promise<void>;
}

/** LS_N_0027 — why a long halt is expected and so not alerted (halt-exclusions.ts). */
export type HaltExclusionKind = 'origin' | 'destination' | HaltExpectedGeofenceType;

/** One active geofence as the halt check sees it. */
export interface HaltGeofence extends GeofenceArea {
  type: GeofenceType;
  name: string;
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
}

/** The tenant's active HALT_CHECK_GEOFENCE_TYPES geofences. */
export interface HaltGeofences {
  list(tenantId: string): Promise<HaltGeofence[]>;
}

/** A master point's pin and geofence radius (null = default). */
export interface TripEndPin extends LatLng {
  radiusM: number | null;
}

/** A trip end: its master point id(s) — what a geofence links to — and the master pin. */
export interface TripEnd {
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
  /** Used only when no geofence is linked to the point. */
  pin: TripEndPin | null;
}

/** What findHaltExclusion checks a halt against. */
export interface HaltExclusionInput {
  tenantId: string;
  /** Where the vehicle is standing. */
  anchor: LatLng;
  origin: TripEnd | null;
  destination: TripEnd | null;
  /** Tracking's own tag on the HALT-GPS alert, honoured as-is. */
  trackingStopPlaceKind: HaltExpectedGeofenceType | null;
  geofences: HaltGeofences;
}

/** Why a halt is expected — the geofence's name for a rest stop / toll plaza. */
export interface HaltExclusion {
  kind: HaltExclusionKind;
  name: string | null;
}

/** One sample context per type, for the test-trigger endpoint (test-trigger.ts). */
export type NotificationSampleContexts = { [K in NotificationTypeKey]?: NotificationContextOf<K> };

export interface NotificationsTestDeps {
  notificationsService: NotificationsService;
  authRepository: AuthRepository;
  authService: AuthService;
}

/** LS_N_0006 — one capability change, with the user's permissions before it (access-change.ts). */
export interface CapabilitiesChangeEvent {
  tenantId: string;
  userId: string;
  actorUserId: string;
  before: string[];
}

export interface AccessChangeResolverDeps {
  getEffectivePermissions(userId: string): Promise<string[]>;
  describePermissions(keys: string[]): Promise<string[]>;
  getUserFullName(userId: string): Promise<string | null>;
  getOrganizationName(tenantId: string): Promise<string>;
}

/** A raw `tracking.events` stream entry as XREADGROUP returns it — flat key/value fields. */
export type TrackingStreamEntry = [id: string, fields: string[]];

/** What the tracking events move: LoadService's stage marks (arrival at pickup → "Reached
 *  loading point", departure → "In transit to unloading", drop arrival → "Reached unloading
 *  point") and GeofenceService's own geofence alerts. */
export interface TrackingEventHandlerDeps {
  markArrivedAtPickup(tenantId: string, loadId: string, at: Date): Promise<boolean>;
  markDepartedPickup(tenantId: string, loadId: string, at: Date): Promise<boolean>;
  markReachedDeliveryPoint(tenantId: string, loadId: string, at: Date): Promise<boolean>;
  markDepartedDrop(tenantId: string, loadId: string, at: Date): Promise<boolean>;
  notifyGeofenceTransition(notice: GeofenceTransitionNotice): Promise<void>;
}

/** The running consumer — `close()` (graceful shutdown) stops after the current batch. */
export interface TrackingEventsConsumer {
  close(): Promise<void>;
}

/** A driver's issue report and the load it's on (breakdown-alerts.ts). */
export interface IssueWithLoad {
  issue: LoadIssueReportEntity;
  load: LoadAlertSnapshot;
}

/** LS_N_0034 — what the E-POD recorded against the lorry receipt. */
export interface ShortageOrDamageSummary {
  shortage: boolean;
  /** How much was short, when the E-POD says. */
  shortTonnes: string | null;
  /** Damaged or wet cargo. */
  damaged: boolean;
}

/** How many of each step one 5-minute trip-timing sweep queued (trip-timing.ts). */
export interface TripTimingRunCounts {
  notReported: number;
  detention: number;
  unloadingDetention: number;
  claimReminders: number;
  podPending: number;
}

/** A driver's saved "Report an issue" (LS_N_0054 / LS_N_0037, breakdown-alerts.ts). */
export interface IssueReportedEvent {
  tenantId: string;
  loadId: string;
  issueId: string;
  category: LoadIssueCategory;
}

/** Called by LoadService.reportIssue after the report is saved — only queues the issue id. */
export type IssueReportedNotifier = (event: IssueReportedEvent) => Promise<void>;
