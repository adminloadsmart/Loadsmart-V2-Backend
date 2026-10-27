import {
  COMPLIANCE_MANAGE,
  CUSTOMERS_APPROVE,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  MAINTENANCE_MANAGE,
  MASTERS_APPROVE,
  MASTERS_WRITE,
  PAYMENTS_MANAGE,
  TRIP_TRACK,
} from '../../../shared/constants/permissions';
import { ORG_ADMIN_ROLE, DISPATCH_ROLE, DOCUMENTS_OPS_ROLE } from '../../../shared/constants/roles';
import { env } from '../../../config/env';
import { toInternationalIndianNumber } from '../../../shared/utils/phone-number';
import { NotificationTemplates, NotificationTypeDefinition } from './notification-catalog.types';
import { LoadPersonRef, NextPlannedTrip } from '../notifications.interface';
import {
  ASSIGNMENT_BLOCK_ALERT_WINDOW_MS,
  CLAIM_REMINDER_DAYS_BEFORE,
  LMV_MAX_GROSS_WEIGHT_KG,
  MS_PER_HOUR,
  POD_PENDING_ALERT_HOURS,
  MS_PER_MINUTE,
  VehicleHaltStep,
} from '../notifications.constants';
import type { HaltExpectedGeofenceType } from '../../geofences/utils/geofence.types';
import { formatIndiaDateTime } from '../utils/trip-time';
import type { AssignmentComplianceSubject, LoadIssueCategory } from '../../loads/utils/loads.types';
import { DEFAULT_LOCALE } from '../../../shared/i18n/locales';
import { t } from '../../../shared/i18n/translate';

/**
 * Every notification type in the app, in one place — deliberately not split per domain: with a
 * small, fixed roster like this, one file is easier to scan than a "which catalog is this type
 * in" hunt across files. src/db/seed-notification-types.ts seeds notification_types straight from
 * this object.
 *
 * Every type currently lists all four channels as available — nothing is grayed out on the
 * settings screen. `defaultChannels` is what an org starts with before its admin has ever saved a
 * preference (matches the settings-screen mockup's shown toggle states); admins can turn any
 * channel on or off from there via PUT /notifications/preferences.
 *
 * Entries with a real trigger say so in a comment above them (LS_N_xxxx). The rest are
 * placeholders for notification types already shown on the settings screen mockup but with no
 * producer/trigger built yet — `buildContent` takes no context and returns generic copy from the
 * label/description below; recipientRoles are provisional best guesses pending each one's real
 * implementation, not confirmed product decisions.
 */

const ALL_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;

export interface VehicleDocumentExpiringContext {
  vehicleId: string;
  vehicleNo: string;
  /** e.g. "Insurance", "Fitness Certificate". */
  docType: string;
  expiryDate: string;
  daysLeft: number;
  /** Trips already planned on this vehicle with pickup after the expiry date. */
  plannedTripCount: number;
  /** Other vehicle documents in the organisation expiring within the next 30 days. */
  otherCount: number;
  /** The check date (YYYY-MM-DD, India time) — one message per vehicle per day. */
  runDate: string;
}

export interface VehicleDocumentExpiredContext {
  vehicleId: string;
  vehicleNo: string;
  docType: string;
  expiryDate: string;
  /** Trips planned on this vehicle from today on, which now need another vehicle. */
  affectedTripCount: number;
  /** The earliest of those trips, when there is one. */
  nextAffectedTrip?: NextPlannedTrip | null;
  runDate: string;
}

export interface DriverLicenceExpiringContext {
  /** A driver can belong to several organisations, and trigger dedupe keys are global — so the
   *  key carries the organisation too. */
  tenantId: string;
  driverId: string;
  driverName: string;
  dlNo: string | null;
  expiryDate: string;
  daysLeft: number;
  /** Upcoming (not yet started) trips the driver is rostered on. */
  tripCount: number;
  runDate: string;
}

export interface DriverLicenceExpiredContext {
  tenantId: string;
  driverId: string;
  driverName: string;
  dlNo: string | null;
  expiryDate: string;
  tripCount: number;
  runDate: string;
  /** 'initial' (9:00, reminded at 11:00) or 'escalation' (13:00, org admins only). */
  stage: 'initial' | 'escalation';
  /** Bring org admins in at 9:00 — driver has a pickup today, or nobody holds compliance.manage. */
  includeOrgAdmins: boolean;
}

/** "Licence DL0420… " or "Licence " when no number is on file. */
const licenceRef = (dlNo: string | null) => (dlNo ? `Licence ${dlNo}` : 'The licence');

export interface BreakdownReportedContext {
  issueId: string;
  loadId: string;
  // Filled in by the context resolver (breakdown-alerts.ts) from the issue report and its trip:
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
  breakdownType?: string;
  location?: string;
  reportTime?: string;
  destination?: string;
  loadCode?: string;
  consignee?: string;
}

/** LS_N_0054 tokens with no data source yet — delivery points carry no coordinates (no distance
 *  to destination) and there is no workshop master with locations. Static until those exist. */
export const BREAKDOWN_STATIC_TOKENS = {
  distanceToDestinationKm: 'N/A',
  workshopName: 'not available yet',
  workshopDistanceKm: 'N/A',
};

export interface VehicleBackInServiceContext {
  jobId: string;
  // Filled in by the context resolver (back-in-service.ts) from the closed workshop visit:
  vehicleId?: string;
  vehicleNo?: string;
  downtimeHours?: string;
  /** Formatted (e.g. "₹12,500"), or null when no cost was entered on the visit. */
  repairCost?: string | null;
  availableFrom?: string;
  /** Requisitions still waiting to be dispatched ("loads waiting on your lanes" — no lanes yet). */
  loadCount?: number;
  /** Recipients allowed to see the repair cost (maintenance.costs.view holders). */
  costViewerIds?: string[];
}

export interface ServiceDueSoonContext {
  vehicleId: string;
  vehicleNo: string;
  kmRemaining: number;
  serviceType: string;
  serviceDueKm: number;
  dailyAvgKm: number;
  daysRemaining: number;
  plannedTripCount: number;
  /** 'threshold' (10% of the interval left) or 'half' (5% left). */
  stage: string;
  runDate: string;
}

export interface ServiceOverdueContext {
  vehicleId: string;
  vehicleNo: string;
  kmOverdue: number;
  serviceType: string;
  serviceDueKm: number;
  currentOdometer: number;
  /** Org-wide 12-month averages; null when there is no costed job of that kind. */
  serviceCost: string | null;
  breakdownCost: string | null;
  /** 2+ weeks overdue (or nobody holds maintenance.manage) — org admins are added. */
  escalated: boolean;
  runDate: string;
}

const km = (value: number) => value.toLocaleString('en-IN');

export interface VehicleIdleWeeklyContext {
  /** The longest-idle vehicle headlines the roll-up; the rest are counted. */
  vehicleId: string;
  vehicleNo: string;
  idleDays: number;
  lastTripDate: string;
  /** Formatted; null when the vehicle has no fixed cost / EMI entered (cost sentence dropped). */
  fixedCostPerDay: string | null;
  idleCost: string | null;
  otherIdleCount: number;
  runDate: string;
}

/** LS_N_0060 — every count is already filtered to what this user can see; a count the user can't
 *  see is left undefined and its phrase is dropped. */
export interface DailyBriefContext {
  userId: string;
  orgName: string;
  tripsRunning: number;
  /** No GPS/ETA data yet — static placeholders, marked "(static)" (see DAILY_BRIEF_STATIC). */
  arrivingToday: string;
  delayed: string;
  podsPending?: number;
  approvalsPending?: number;
  vehiclesBlocked?: number;
  emptyVehicles?: number;
  idleLocations?: string;
  needsAction: number;
  runDate: string;
}

/** LS_N_0060 tokens with no data source yet (no GPS, ETA or vehicle location). Each is marked
 *  "(static)" in the text and listed in the notification's `static_tokens` metadata. */
export const DAILY_BRIEF_STATIC = {
  arrivingToday: '0 (static)',
  delayed: '0 (static)',
  idleLocations: 'location unavailable (static)',
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface TyreAttentionContext {
  vehicleId: string;
  vehicleNo: string;
  /** Every tyre on the vehicle in the maintenance tyres queue, by position. */
  tyres: {
    tyreId: string;
    position: string;
    km: number;
    /** 'retread' / 'replacement' / 'scrapping'. */
    action: string;
    /** Formatted cost per km; null when no cost is recorded for this tyre. */
    cpk: string | null;
    /** Current tread depth in mm (latest reading, else the wear estimate). */
    treadMm?: number | null;
  }[];
  fleetCpk: string | null;
  runDate: string;
}

export interface VehicleDocumentsRollupContext {
  /** Vehicle documents in the organisation expiring within the next 30 days. */
  docCount: number;
  /** "Insurance on MH12AB1234 — 2026-10-05; …" for the email template. */
  docList: string;
  runDate: string;
}

export interface OrganizationApprovedContext {
  orgName: string;
}

export interface OrganizationSignupReceivedContext {
  orgName: string;
}

export interface OrganizationNotApprovedContext {
  orgName: string;
  /** The reviewer's deny reason, sent verbatim (organization.decisionReason). */
  reason: string;
}

export interface TeamMemberInvitedContext {
  /** The invited user — the recipient. */
  userId: string;
  inviterName: string;
  orgName: string;
  /** What they can do, e.g. "manage load requisitions and create customers". */
  capabilitySummary: string;
  /** Set by the trigger worker on the 24-hour reminder. */
  isReminder?: boolean;
}

export interface AccessChangedContext {
  /** The user whose access changed — the recipient. */
  userId: string;
  adminUserId: string;
  /** Effective permission keys before the first change of the burst (see access-change.ts). */
  baselinePermissions: string[];
  // Filled in by the context resolver right before sending (access-change.ts):
  adminName?: string;
  orgName?: string;
  addedCapabilities?: string;
  removedCapabilities?: string;
  removedCount?: number;
}

/** LS_N_0006's two optional sentences — also sent whole to the email template as access_summary,
 *  since a template can't drop a sentence when its list is empty. */
function accessChangeSentences({
  addedCapabilities,
  removedCapabilities,
  removedCount,
}: AccessChangedContext): string {
  const sentences: string[] = [];
  if (addedCapabilities) sentences.push(`You can now ${addedCapabilities}.`);
  if (removedCapabilities) {
    const removed = removedCapabilities.charAt(0).toUpperCase() + removedCapabilities.slice(1);
    sentences.push(
      `${removed} ${(removedCount ?? 0) > 1 ? 'are' : 'is'} no longer available to you.`,
    );
  }
  return sentences.join(' ');
}

/** Master record types with a pending → approve flow (LS_N_0009/0010). Transporters have none. */
export type MasterKind = 'vehicle' | 'driver' | 'loading_point' | 'product' | 'customer';

export const MASTER_KIND_LABELS: Record<MasterKind, string> = {
  vehicle: 'Vehicle',
  driver: 'Driver',
  loading_point: 'Loading point',
  product: 'Product',
  customer: 'Customer',
};

/** Suggested frontend routes — the frontend owns routing, so every notification also carries
 *  record_kind + record_id for it to build its own link. */
const MASTER_RECORD_PATHS: Record<MasterKind, string> = {
  vehicle: '/masters/vehicles',
  driver: '/masters/drivers',
  loading_point: '/masters/loading-points',
  product: '/masters/products',
  customer: '/customers',
};
const APPROVALS_PATH = '/settings/approvals';

/** Who can approve a kind — mirrors the code that gates approval: masters.approve for the four
 *  masters; customers.approve AND org_admin for customers (CustomerService.approve also asserts
 *  the org_admin role). */
export function masterApprovers(kind: MasterKind): { permission: string; role?: string } {
  return kind === 'customer'
    ? { permission: CUSTOMERS_APPROVE, role: ORG_ADMIN_ROLE }
    : { permission: MASTERS_APPROVE };
}

export interface MasterApprovalRequestedContext {
  kind: MasterKind;
  recordId: string;
  /** The record as people know it — registration number, driver name, title, etc. */
  masterValue: string;
  createdByUserId: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  userName?: string;
}

export interface MasterApprovalsWaitingContext {
  /** The approver — the recipient. */
  userId: string;
  /** Filled in by the context resolver: records still pending that they can approve. */
  waitingCount?: number;
}

export interface MasterApprovedContext {
  kind: MasterKind;
  recordId: string;
  masterValue: string;
  /** The creator — the recipient. */
  createdByUserId: string;
  approvedByUserId: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  adminName?: string;
}

export interface MasterRejectedContext {
  kind: MasterKind;
  recordId: string;
  masterValue: string;
  /** The creator — the recipient. */
  createdByUserId: string;
  rejectedByUserId: string;
  /** The reviewer's rejection reason, as typed. */
  reason: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  adminName?: string;
}

export interface VahanUnverifiedContext {
  vehicleId: string;
  vehicleNo: string;
  /** Who added the vehicle — notified alongside compliance.manage holders. */
  createdByUserId: string | null;
}

export interface OrganizationDocumentPendingContext {
  orgName: string;
  /** Human-readable name of the exact document, e.g. "GST certificate". */
  docType: string;
  documentId: string;
  /** Set by the trigger worker on the 48-hour reminder. */
  isReminder?: boolean;
}

export interface DriverLinkContext {
  /** masters.drivers id — set for join requests and accepted invites (the inbox card links to
   *  the driver). */
  driverId?: string;
  driverName: string;
  phoneNumber: string;
}

/** What load-alerts.ts's resolver reads off a load for every load-event card. Optional because
 *  the trigger site only queues the ids; the resolver fills the rest before sending. */
export interface LoadSummary {
  loadId: string;
  loadCode?: string;
  vehicleNo?: string | null;
  /** "Ludhiana to Bhiwandi"; null when neither end has a city. */
  route?: string | null;
  transporterName?: string | null;
  consignee?: string | null;
}

export interface EwayBillExpiryContext extends LoadSummary {
  /** The generation this alert is for — a regenerated bill makes this one stale (ISO). */
  generatedAt: string;
  expiresAt: string;
  ewayBillNumber?: string | null;
  destination?: string | null;
  /** Tracking's projected arrival (ISO); null when tracking has no ETA yet (no GPS / route). */
  etaAt?: string | null;
}

/** LS_N_0024 — what the load looked like when loading was confirmed. */
export interface VehicleLoadedContext extends LoadSummary {
  /** When loading was confirmed (ISO). */
  loadedAt: string;
  /** The driver (driver app) or staff user who confirmed it. */
  confirmedBy: LoadPersonRef;
  /** The placeholder expiry LoadService computes (generated + 2 h) — no real validity yet (ISO). */
  ewayBillExpiresAt?: string | null;
  // Filled in by the resolver:
  origin?: string | null;
  confirmedByName?: string | null;
  cargoTonnes?: string | null;
  documentCount?: number;
  elrNumber?: string | null;
  /** The E-LR file is on the load (its number is optional). */
  hasLorryReceipt?: boolean;
  ewayBillNumber?: string | null;
}

/** LS_N_0021 — queued by the trip-timing sweep (trip-timing.ts) for one step of the ladder. */
export interface VehicleNotReportedContext extends LoadSummary {
  /** When the vehicle was due at the loading point (ISO). */
  reportingAt: string;
  /** 0, 1, 2 — the 60 min / 3 h / 5 h alert; org admins join from step 1. */
  step: number;
  // Filled in by the resolver:
  origin?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  isOwnFleet?: boolean;
  createdBy?: string | null;
  lateMinutes?: number;
  /** From tracking's last position for the vehicle, when it has one. */
  lastSeenPlace?: string | null;
  distanceAwayKm?: number | null;
}

/** LS_N_0022 — from the manual "At plant" step or tracking's geofence entry. */
export interface VehicleReachedPickupContext extends LoadSummary {
  /** When the vehicle reached the loading point (ISO). */
  arrivedAt: string;
  // Filled in by the resolver:
  origin?: string | null;
  reportingAt?: string | null;
  freeTimeEndsAt?: string | null;
}

/** LS_N_0023 — queued by the trip-timing sweep for each 4-hour step of detention. */
export interface DetentionAtLoadingContext extends LoadSummary {
  /** When the vehicle reached the loading point (ISO) — the detention clock's start. */
  arrivedAt: string;
  /** 0 at the free-time boundary, then one per DETENTION_REPEAT_HOURS. */
  step: number;
  // Filled in by the resolver:
  origin?: string | null;
  hoursAtOrigin?: number;
  freeHours?: number;
  /** "₹2,000" — billable hours beyond the free time × the rate. */
  amount?: string;
  ratePerHour?: string;
}

/** LS_N_0031 — from the manual "Reached delivery point" step or tracking's geofence entry. */
export interface VehicleReachedDropContext extends LoadSummary {
  /** When the vehicle reached the delivery point (ISO). */
  arrivedAt: string;
  // Filled in by the resolver:
  /** End of the promised delivery day, IST (ISO); null when the load has no promised date. */
  promisedAt?: string | null;
  freeTimeEndsAt?: string | null;
}

/** LS_N_0032 — queued by the trip-timing sweep for each 4-hour step of unloading detention. */
export interface DetentionAtUnloadingContext extends LoadSummary {
  /** When the vehicle reached the delivery point (ISO) — the detention clock's start. */
  arrivedAt: string;
  /** 0 at the free-time boundary, then one per DETENTION_REPEAT_HOURS. */
  step: number;
  // Filled in by the resolver:
  destination?: string | null;
  hoursAtDestination?: number;
  freeHours?: number;
  /** "₹2,000" — billable hours beyond the free time × the rate. */
  amount?: string;
}

/** LS_N_0033 — queued on the E-POD (now, and once more after TRIP_COMPLETED_FALLBACK_MS) and on
 *  tracking's exit from the delivery point; the resolver sends it once both have happened. */
export interface TripCompletedContext extends LoadSummary {
  /** The post-E-POD retry: complete even though tracking never saw the vehicle leave. */
  fallback?: boolean;
  // Filled in by the resolver:
  createdBy?: string | null;
  quantityTonnes?: string | null;
  /** When the vehicle left the delivery point (ISO); null when tracking never saw it leave. */
  departedAt?: string | null;
}

/** "26 h" reads badly for a late delivery: "1 day 2 h" / "2 days" / else durationOf. */
function delayOf(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  if (!days) return durationOf(total);
  const hours = Math.floor((total % 1440) / 60);
  return `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} h` : ''}`;
}

/** LS_N_0030's "Main reason: …". */
function delayReasonOf(context: DeliveryLateContext): string {
  switch (context.delayCause) {
    case 'halts':
      return `long halts on the way (${durationOf(context.causeMin ?? 0)} stopped)`;
    case 'deviation':
      return `off the planned route for ${durationOf(context.causeMin ?? 0)}`;
    default:
      return context.speedKmh
        ? `slow progress (about ${context.speedKmh} km/h)`
        : 'slow progress on the route';
  }
}

/** " Check with Ramesh on 98765 00000" style driver line; '' when neither is known. */
function driverContactOf(name?: string | null, phone?: string | null): string {
  if (name && phone) return `${name} on ${phone}`;
  return name ?? phone ?? '';
}

/** "45 min" / "1 h 20 min" / "3 h". */
function durationOf(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** LS_N_0026 — from tracking's `trip.departed_pickup` event (tracking-events.consumer.ts). */
export interface VehicleInTransitContext extends LoadSummary {
  /** When the vehicle left the loading point's geofence (ISO). */
  departedAt: string;
  // Filled in by the resolver:
  origin?: string | null;
  destination?: string | null;
  /** Tracking's projected arrival (ISO) and road km left; null when tracking has none yet. */
  etaAt?: string | null;
  remainingKm?: number | null;
}

/** LS_N_0027 — queued from tracking's HALT-GPS alert (tracking-events.consumer.ts), one per
 *  step of VEHICLE_HALT_ALERT_STEPS. */
export interface VehicleHaltedContext extends LoadSummary {
  /** Tracking's HALT-GPS alert id — one halt. */
  haltAlertId: string;
  /** When the truck stopped (ISO). */
  haltStartedAt: string;
  /** Where the truck stopped (tracking's halt anchor). */
  anchorLat: number;
  anchorLng: number;
  /** Rest stop / toll plaza, when tracking itself tagged the halt; null otherwise. */
  stopPlaceKind?: HaltExpectedGeofenceType | null;
  /** '2h' — the first alert; '6h' — only if the same halt crossed 6 hours. */
  step: VehicleHaltStep;
  // Filled in by the resolver:
  /** Tracking's place name for the truck's position, else "lat, lng". */
  location?: string | null;
  destination?: string | null;
  /** Tracking's projected arrival (ISO) and how far it is behind the promised delivery time. */
  revisedEtaAt?: string | null;
  delayMin?: number | null;
  haltDurationMin?: number;
  driverName?: string | null;
  driverPhone?: string | null;
}

/** LS_N_0028 — from tracking's `trip.route_deviation` notice (tracking-events.consumer.ts): the
 *  truck has been over 15 km off every planned route for 45 min and is heading away from the drop. */
export interface RouteDeviationContext extends LoadSummary {
  /** When this deviation began (ISO) — one notification per deviation. */
  deviationStartedAt: string;
  /** How far off the route the truck was when it qualified. */
  distanceOffKm: number;
  lat: number;
  lng: number;
  // Filled in by the resolver:
  /** Tracking's place name for the truck's position, else "lat, lng". */
  location?: string | null;
  revisedEtaAt?: string | null;
  deviationDurationMin?: number;
  driverName?: string | null;
  driverPhone?: string | null;
}

/** LS_N_0029 — from tracking's `trip.signal_lost` notice: no position for 4 h, 12 h, then daily. */
export interface TrackingSignalLostContext extends LoadSummary {
  /** '4h' | '12h' | 'day_1', 'day_2', … — one notification per step of one silence. */
  step: string;
  /** The last position (ISO) — or when the trip started running, if none since. */
  lastSeenAt: string;
  lastLat: number | null;
  lastLng: number | null;
  // Filled in by the resolver:
  lastLocation?: string | null;
  hoursSince?: number;
  destination?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
}

/** LS_N_0030 — from tracking's `trip.delivery_late` notice: the projected delay passed the
 *  company's limit (org setting, default one day); again each time the delay doubles. */
export interface DeliveryLateContext extends LoadSummary {
  /** 1 for the first notice on this load, 2 once the delay doubled, … */
  sequence: number;
  delayMin: number;
  /** Tracking's projected arrival (ISO); null when it has no fresh ETA (already past promised). */
  etaAt: string | null;
  promisedAt: string;
  /** What tracking measured as the main cause. */
  delayCause: 'halts' | 'deviation' | 'slow_progress';
  causeMin: number | null;
  speedKmh: number | null;
  // Filled in by the resolver:
  destination?: string | null;
  createdBy?: string | null;
}

export interface PodUploadedContext extends LoadSummary {
  /** Identifies this upload — a resubmission after rejection is a new alert (ISO). */
  uploadedAt: string;
  receiverName?: string | null;
  quantityReceived?: string | null;
  tonnesShort?: string | null;
  shortageOrDamage?: string | null;
  // LS_N_0038, filled in by the resolver:
  createdBy?: string | null;
  driverName?: string | null;
  lrNumber?: string | null;
  origin?: string | null;
  destination?: string | null;
  /** "₹28,000" — the transporter's balance this POD holds up (freight minus advance); null for
   *  own-fleet loads, no agreed freight, or a balance already paid. */
  balanceAmount?: string | null;
}

/** LS_N_0039 — queued by the trip-timing sweep POD_PENDING_ALERT_HOURS into a wait for the POD. */
export interface PodPendingContext extends LoadSummary {
  /** When the wait started (ISO): the arrival at the delivery point, or the E-POD's rejection. A
   *  new arrival or rejection makes this one stale. */
  since: string;
  /** Index into POD_PENDING_ALERT_HOURS — the last step goes to org admins only. */
  step: number;
  // Filled in by the resolver:
  /** The E-POD was rejected and hasn't been re-uploaded (the wait runs from the rejection). */
  rejected?: boolean;
  hoursSince?: number;
  createdBy?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  /** "₹24,000" — the transporter's freight; null for own-fleet loads or no agreed freight. */
  amount?: string | null;
}

/** LS_N_0040 (rejected) / LS_N_0041 (accepted) — queued by LoadService.reviewPod. */
export interface PodReviewedContext extends LoadSummary {
  /** The review this alert is for (ISO podReviewedAt) — a later review makes it stale. */
  reviewedAt: string;
  // Filled in by the resolver:
  createdBy?: string | null;
  verifierName?: string | null;
  reason?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  lrNumber?: string | null;
  /** "₹24,000" — the transporter's freight; null for own-fleet loads or no agreed freight. */
  amount?: string | null;
  /** A market load whose transporter balance isn't paid yet (LS_N_0041). */
  balanceDue?: boolean;
}

/** LS_N_0034 — queued on the E-POD (once), and by the trip-timing sweep CLAIM_REMINDER_DAYS_BEFORE
 *  days before the claim window closes (`reminder`). */
export interface ShortageRecordedContext extends LoadSummary {
  reminder?: boolean;
  // Filled in by the resolver:
  createdBy?: string | null;
  /** A shortage was recorded; `shortTonnes` is how much ("0.5"), when the E-POD says. */
  shortage?: boolean;
  shortTonnes?: string | null;
  /** Damage (or wet cargo) was recorded. */
  damaged?: boolean;
  lrNumber?: string | null;
  /** "₹3,000" — MT short × the cargo value per MT; null when either is unknown. */
  claimValue?: string | null;
  claimWindowDays?: number;
  /** When the claim window closes (ISO). */
  claimDeadline?: string;
}

/** LS_N_0037 — queued when a driver reports an accident, road block, police check, strike, bad
 *  weather or another problem (breakdown-alerts.ts). */
export interface DriverProblemReportedContext extends LoadSummary {
  issueId: string;
  // Filled in by the resolver (breakdown-alerts.ts) from the report and its trip:
  category?: LoadIssueCategory;
  driverName?: string | null;
  driverPhone?: string | null;
  location?: string | null;
  /** When the driver reported it (ISO). */
  reportedAt?: string;
  driverNote?: string | null;
  /** The report's expected delay; null until something estimates it. */
  etaImpactMinutes?: number | null;
}

/** "No tracking means alerts": 2 h and 1 h before the pickup or the drop ETA, while the truck
 *  hasn't been marked there yet. */
export interface LoadArrivalReminderContext extends LoadSummary {
  /** 120 or 60. */
  leadMinutes: number;
  /** The pickup time or drop ETA the reminder counts down to (ISO). */
  dueAt: string;
}

/** Loadsmart's invoice falling due — the shipper's finance team is reminded before the date. */
export interface InvoiceDueContext extends LoadSummary {
  invoiceNumber: string;
  /** "₹1,23,456.00" */
  balanceDue: string;
  /** YYYY-MM-DD */
  dueDate: string;
}

export interface AdvanceDueContext extends LoadSummary {
  advancePercentage?: string | null;
  /** "₹41,797"; null when the load has no agreed freight yet. */
  amount?: string | null;
  bankName?: string | null;
  accountLast4?: string | null;
}

/** LS_N_0050 — queued after every assignment; the resolver sends it only for a confirmed mismatch
 *  (licence-check.ts). */
export interface LicenceMismatchContext extends LoadSummary {
  /** Identifies the assignment — a reassignment is checked afresh (ISO). */
  assignedAt: string;
  // Filled in by the resolver:
  driverName?: string | null;
  licenceClass?: string | null;
  grossVehicleWeightKg?: number | null;
  needsTransportClass?: boolean;
  needsHazmatEndorsement?: boolean;
  hazardousProducts?: string[];
}

/** LS_N_0016 — queued with the assignment-time check's result; the rest is read off the load at
 *  send time (load-alerts.ts). */
export interface VehicleAssignedContext extends LoadSummary {
  /** Identifies this assignment (ISO). */
  assignedAt: string;
  /** Whether the masters had the vehicle / driver to check — a typed-in market vehicle or driver
   *  that isn't on file can't be. */
  vehicleChecked: boolean;
  driverChecked: boolean;
  isOwnFleet?: boolean;
  driverName?: string | null;
  driverPhone?: string | null;
  origin?: string | null;
  /** "17 Oct" / "17 Oct, 14:30" — the pickup; no reporting time is captured on a load yet. */
  reportingTime?: string | null;
  /** The user who created the load — notified alongside trip.track holders. */
  createdBy?: string | null;
}

/** LS_N_0017 — the refused assignment, as queued (nothing was saved), plus what the resolver
 *  reads at send time. */
export interface AssignmentComplianceFailedContext {
  /** When the assignment was refused (ISO). */
  blockedAt: string;
  /** Market Load Assignment. */
  loadId?: string | null;
  /** Own-fleet Dispatch Planning. Neither id → own-fleet Post a load. */
  requisitionId?: string | null;
  vehicleNo: string;
  vehicleId?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  subject: AssignmentComplianceSubject;
  docType: string;
  expiryDate: string;
  transporterName?: string | null;
  origin?: string | null;
  destination?: string | null;
  /** Post a load's pickup time (ISO). */
  pickupAt?: string | null;
  // Filled in by the resolver:
  /** The load's or requisition's code. */
  referenceCode?: string | null;
  route?: string | null;
  reportingTime?: string | null;
}

/** One blocked assignment — the same vehicle refused for the same load/requisition/post for the
 *  same reason. Keys trigger dedupe and the "already alerted in the last hour" check. */
export function assignmentBlockKeyOf(context: AssignmentComplianceFailedContext): string {
  const target = context.loadId ?? context.requisitionId ?? 'post';
  const plate = context.vehicleNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${target}-${plate}-${context.subject}`;
}

/** LS_N_0016's "Compliance checked and clear." — says what couldn't be checked rather than
 *  claiming a clear result for a typed-in vehicle or driver that isn't in the masters. */
function assignmentComplianceSentenceOf(context: VehicleAssignedContext): string {
  const hasDriver = Boolean(context.driverName || context.driverPhone);
  if (context.vehicleChecked && (context.driverChecked || !hasDriver)) {
    return 'Compliance checked and clear.';
  }
  if (context.vehicleChecked) {
    return "Vehicle documents checked and clear. The driver isn't in your driver list, so their licence wasn't checked.";
  }
  if (context.driverChecked) {
    return "Driver's licence checked and clear. The vehicle isn't in your fleet list, so its documents weren't checked.";
  }
  return "The vehicle isn't in your fleet list, so its documents weren't checked.";
}

/** "HH:MM" in India time. */
const formatIndiaTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** "21 Oct" in India time. */
const formatIndiaDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));

/** LS_N_0037's "{{issue_type}}" — how a driver's report reads in "Ramesh reported … on LD-1001". */
const DRIVER_PROBLEM_LABELS: Record<LoadIssueCategory, string> = {
  accident: 'an accident',
  road_blocked: 'a road block',
  police_rto_check: 'a police/RTO check',
  strike: 'a strike',
  weather: 'bad weather',
  other: 'a problem',
  breakdown: 'a breakdown',
  traffic_jam: 'a traffic jam',
  halt_rest_stop: 'a halt',
};

/** LS_N_0031's "{{early_late}}": "2 h early" / "1 day 3 h late" / "on time" against `due`. */
function earlyLateOf(at: string, due: string): string {
  const minutes = (new Date(at).getTime() - new Date(due).getTime()) / 60_000;
  if (Math.abs(minutes) < 1) return 'on time';
  return minutes < 0 ? `${delayOf(-minutes)} early` : `${delayOf(minutes)} late`;
}

/** Metadata every load-event card carries. */
function loadMetadataOf(context: LoadSummary): Record<string, string> {
  return {
    load_id: context.loadId,
    load_code: context.loadCode ?? '',
    vehicle_no: context.vehicleNo ?? '',
    route: context.route ?? '',
    transporter_name: context.transporterName ?? '',
    consignee: context.consignee ?? '',
  };
}

/** " 0.50 t short." / " Damage reported." / "" for the POD card. */
function podExceptionSentenceOf(context: PodUploadedContext): string {
  if (context.tonnesShort && Number(context.tonnesShort) > 0) {
    return ` ${context.tonnesShort} t short.`;
  }
  switch (context.shortageOrDamage) {
    case 'both':
      return ' Shortage and damage reported.';
    case 'damage':
      return ' Damage reported.';
    case 'shortage':
      return ' Shortage reported.';
    default:
      return '';
  }
}

/** First word of the recipient's name for "Hi {{first_name}}" copy — the org-signup user's
 *  fullName is optional (saved in the onboarding user-details step), hence the fallback. */
function firstNameOf(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'there';
}

export const NOTIFICATION_CATALOG = {
  // LS_N_0001 — fired once by admin.service.ts's approveOrganization. The WhatsApp/SMS/email
  // copy itself lives in MSG91 templates (DLT/Meta-approved); this app only sends the variables.
  // SMS always goes out; WhatsApp only when whatsappOptIn is true — not captured (null) or
  // declined means SMS only (see notify-by-type.ts).
  'organization.account_approved': {
    label: 'Account approved',
    category: 'account',
    description: 'Your organisation has been approved on Loadsmart.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['whatsapp', 'sms', 'email'],
    defaultChannels: ['whatsapp', 'sms', 'email'],
    severity: 'p2_action',
    frequency: 'once_per_tenant',
    requiresWhatsappOptIn: true,
    // LS_N_0001's channels are WhatsApp, SMS and Email only — stored (once_per_tenant needs the
    // row) but never shown in the bell.
    inApp: false,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateOrgApproved,
        variables: ['first_name', 'org_name'],
      },
      sms: { templateId: env.msg91SmsTemplateOrgApproved, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateOrgApproved,
        variables: { first_name: 'first_name', org_name: 'org_name' },
      },
    },
    buildContent: ({ orgName }: OrganizationApprovedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `${orgName} is live on Loadsmart`,
        body: `Welcome ${firstName}. Your account is approved. Add your vehicles and drivers, then create your first trip.`,
        metadata: {
          first_name: firstName,
          org_name: orgName,
          cta_label: 'Set up my fleet',
          cta_path: '/',
        },
      };
    },
  },

  // LS_N_0002 — fired by auth.service.ts's submitOrganization on the org's first submission for
  // review (not correction resubmits). SMS + email only: no WhatsApp opt-in exists yet at this
  // point. SMS/email copy lives in MSG91 templates; this app only sends the variables.
  'organization.signup_received': {
    label: 'Signup received',
    category: 'account',
    description: 'Your application has been received and is under review.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p3_info',
    frequency: 'once_per_tenant',
    // Spec: in-app "Not applicable, no app access yet" — stored for tracking, hidden in the app.
    inApp: false,
    templates: {
      sms: { templateId: env.msg91SmsTemplateSignupReceived, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateSignupReceived,
        variables: { first_name: 'first_name', org_name: 'org_name' },
      },
    },
    buildContent: ({ orgName }: OrganizationSignupReceivedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `We have your application for ${orgName}`,
        body: `${firstName}, we are verifying the GST and PAN details for ${orgName}. Most accounts are approved within one working day and we will message you as soon as it is done.`,
        metadata: { first_name: firstName, org_name: orgName },
      };
    },
  },

  // LS_N_0003 — fired by admin.service.ts's verifyOrganizationDocument when a reviewer marks a KYC
  // document invalid (unreadable/missing) while the org is under review. SMS + email only, not
  // in-app (no app access yet). One reminder after 48h, only if that exact document is still
  // invalid then (see AdminService.isDocumentReuploadPending), then stop.
  'organization.document_more_info_needed': {
    label: 'More information needed',
    category: 'account',
    description: 'A KYC document could not be verified and a clear copy is needed.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: OrganizationDocumentPendingContext) => context.documentId,
    reminderAfterMs: 48 * 60 * 60 * 1000,
    templates: {
      sms: { templateId: env.msg91SmsTemplateDocumentPending, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateDocumentPending,
        variables: { first_name: 'first_name', org_name: 'org_name', doc_type: 'doc_type' },
      },
    },
    buildContent: (
      { orgName, docType, documentId, isReminder }: OrganizationDocumentPendingContext,
      recipient,
    ) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `One document pending for ${orgName}`,
        body: `${firstName}, we could not verify ${docType} for ${orgName}. Send a clear copy and we will approve the account the same day.`,
        metadata: {
          first_name: firstName,
          org_name: orgName,
          doc_type: docType,
          document_id: documentId,
          ...(isReminder ? { reminder: 'true' } : {}),
        },
      };
    },
  },

  // LS_N_0004 — fired by admin.service.ts's denyOrganization (POST .../deny only). Email only:
  // the spec rules out SMS for a rejection, and there's no app access (sessions are revoked on
  // deny). `reason` is the reviewer's text as typed. Once per organisation.
  'organization.account_not_approved': {
    label: 'Account not approved',
    category: 'account',
    description: 'Your organisation could not be approved.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p3_info',
    frequency: 'once_per_tenant',
    inApp: false,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateOrgNotApproved,
        variables: { first_name: 'first_name', org_name: 'org_name', reason: 'reason' },
      },
    },
    buildContent: ({ orgName, reason }: OrganizationNotApprovedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `About your Loadsmart application for ${orgName}`,
        body: `${firstName}, we are not able to open a Loadsmart account for ${orgName} at this time. Reason: ${reason}. If this looks wrong, reply to this mail and we will look again.`,
        metadata: { first_name: firstName, org_name: orgName, reason },
      };
    },
  },

  // LS_N_0005 — fired by auth.service.ts's inviteOrganizationUser, to the invited person only.
  // SMS (+ email only if they have one on file). Not in-app ("until the password is set") and no
  // WhatsApp (no opt-in captured yet). One reminder after 24h only if they still haven't signed in
  // (relevance check in composition-root.ts), then stop.
  'organization.team_member_invited': {
    label: 'Team member invited',
    category: 'account',
    description: 'You have been added to an organisation on Loadsmart.',
    recipientRoles: [],
    recipientUserId: (context: TeamMemberInvitedContext) => context.userId,
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: TeamMemberInvitedContext) => context.userId,
    reminderAfterMs: 24 * 60 * 60 * 1000,
    templates: {
      sms: { templateId: env.msg91SmsTemplateTeamInvite, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateTeamInvite,
        variables: {
          first_name: 'first_name',
          inviter_name: 'inviter_name',
          org_name: 'org_name',
          capability_summary: 'capability_summary',
        },
      },
    },
    buildContent: (
      { inviterName, orgName, capabilitySummary, isReminder }: TeamMemberInvitedContext,
      recipient,
    ) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `${inviterName} has added you to ${orgName} on Loadsmart`,
        body: `${firstName}, ${inviterName} has added you to ${orgName} on Loadsmart. You can ${capabilitySummary}. Set your password to get started.`,
        metadata: {
          first_name: firstName,
          inviter_name: inviterName,
          org_name: orgName,
          capability_summary: capabilitySummary,
          cta_label: 'Set my password',
          ...(isReminder ? { reminder: 'true' } : {}),
        },
      };
    },
  },

  // LS_N_0006 — fired (via RoleService's onCapabilitiesChanged hook, see access-change.ts) when an
  // org admin grants/revokes a capability or changes a teammate's role. In-app + email (if on
  // file). Debounced: a burst of changes becomes ONE message ~2 min after the last one, listing
  // the net additions/removals; nothing is sent when the net effect is nil.
  'user.access_changed': {
    label: 'Your access changed',
    category: 'account',
    description: 'What you can do in your organisation was updated.',
    recipientRoles: [],
    recipientUserId: (context: AccessChangedContext) => context.userId,
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p3_info',
    dedupeKey: (context: AccessChangedContext) => context.userId,
    debounceMs: 2 * 60 * 1000,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateAccessChanged,
        variables: {
          first_name: 'first_name',
          admin_name: 'admin_name',
          org_name: 'org_name',
          added_capabilities: 'added_capabilities',
          removed_capabilities: 'removed_capabilities',
          access_summary: 'access_summary',
        },
      },
    },
    buildContent: (context: AccessChangedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName ?? 'Your admin';
      const orgName = context.orgName ?? 'your organisation';
      const summary = accessChangeSentences(context);
      return {
        title: 'Your access has been updated',
        body: `${firstName}, ${adminName} updated what you can do in ${orgName}. ${summary}`.trim(),
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          org_name: orgName,
          added_capabilities: context.addedCapabilities ?? '',
          removed_capabilities: context.removedCapabilities ?? '',
          access_summary: summary,
          cta_label: 'See what I can do',
          cta_path: '/',
        },
      };
    },
  },

  // LS_N_0009 — fired (via master-approvals.ts) when a non-admin creates a vehicle, driver,
  // loading point, product or customer, which then waits as 'pending'. To everyone who can
  // approve that kind (not the creator), in-app + push. Each approver gets at most 3 individual
  // ones per hour; beyond that they get one 'organization.master_approvals_waiting' summary.
  'organization.master_approval_requested': {
    label: 'Master addition needs approval',
    category: 'approvals',
    description:
      'A new vehicle, driver, loading point, product or customer is waiting for approval.',
    recipientRoles: [],
    recipientPermission: (context: MasterApprovalRequestedContext) => masterApprovers(context.kind),
    excludeUserId: (context: MasterApprovalRequestedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterApprovalRequestedContext) => `${context.kind}-${context.recordId}`,
    recipientRateLimit: {
      max: 3,
      windowSeconds: 60 * 60,
      overflowType: 'organization.master_approvals_waiting',
    },
    buildContent: (context: MasterApprovalRequestedContext) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const userName = context.userName || 'A teammate';
      return {
        title: `${masterType} waiting for your approval`,
        body: `${userName} added ${context.masterValue}. It cannot be used in a trip until you approve it.`,
        metadata: {
          master_type: masterType,
          master_value: context.masterValue,
          user_name: userName,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Review and approve',
          cta_path: APPROVALS_PATH,
        },
      };
    },
  },

  // LS_N_0009's collapsed form — one per approver, debounced, counting what's still pending.
  'organization.master_approvals_waiting': {
    label: 'Master approvals waiting',
    category: 'approvals',
    description: 'Several master records are waiting for your approval.',
    recipientRoles: [],
    recipientUserId: (context: MasterApprovalsWaitingContext) => context.userId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterApprovalsWaitingContext) => context.userId,
    debounceMs: 5 * 60 * 1000,
    buildContent: ({ waitingCount = 0 }: MasterApprovalsWaitingContext) => {
      const what = waitingCount === 1 ? '1 master record is' : `${waitingCount} master records are`;
      return {
        title: `${what} waiting for your approval`,
        body: `${what} waiting for your approval. They cannot be used in a trip until you approve them.`,
        metadata: {
          waiting_count: String(waitingCount),
          cta_label: 'Review and approve',
          cta_path: APPROVALS_PATH,
        },
      };
    },
  },

  // LS_N_0010 — fired (via master-approvals.ts) when someone approves a record another user
  // created. In-app only, to the creator; one per record.
  'organization.master_approved': {
    label: 'Master approved',
    category: 'approvals',
    description: 'A vehicle, driver, loading point, product or customer you added was approved.',
    recipientRoles: [],
    recipientUserId: (context: MasterApprovedContext) => context.createdByUserId,
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: MasterApprovedContext) => `${context.kind}-${context.recordId}`,
    buildContent: (context: MasterApprovedContext, recipient) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName || 'Your admin';
      return {
        title: `${masterType} approved`,
        body: `${firstName}, ${adminName} approved ${context.masterValue}. You can use it in a trip now.`,
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          master_type: masterType,
          master_value: context.masterValue,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Use it in a trip',
          cta_path: `${MASTER_RECORD_PATHS[context.kind]}/${context.recordId}`,
        },
      };
    },
  },

  // LS_N_0011 — fired (via master-approvals.ts) when someone rejects a pending vehicle, driver,
  // loading point, product or customer another user created. In-app + push to the creator; one
  // per record. Note: the masters have no resubmit flow yet — a rejected record stays rejected
  // after editing — so "send it again" relies on that being built.
  'organization.master_rejected': {
    label: 'Master rejected',
    category: 'approvals',
    description:
      'A vehicle, driver, loading point, product or customer you added was not approved.',
    recipientRoles: [],
    recipientUserId: (context: MasterRejectedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterRejectedContext) => `${context.kind}-${context.recordId}`,
    buildContent: (context: MasterRejectedContext, recipient) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName || 'Your admin';
      return {
        title: `${masterType} was not approved`,
        body: `${firstName}, ${adminName} did not approve ${context.masterValue}. Reason given: ${context.reason}. Edit the details and send it again.`,
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          master_type: masterType,
          master_value: context.masterValue,
          reason: context.reason,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Edit and resubmit',
          cta_path: `${MASTER_RECORD_PATHS[context.kind]}/${context.recordId}`,
        },
      };
    },
  },

  // LS_N_0012 — the app records Vahan results (the backend does no lookup itself). When a vehicle
  // gets a not_found / manual_review result, this is scheduled 24h after the FIRST failure (the
  // window for the app/user to retry) and only sent if the vehicle still isn't verified then
  // (relevance check in composition-root.ts). To whoever added it + compliance.manage holders.
  'vehicle.vahan_unverified': {
    label: 'Vehicle could not be verified on Vahan',
    category: 'compliance',
    description: 'A newly added vehicle registration could not be verified on Vahan.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    alsoNotifyUserId: (context: VahanUnverifiedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: VahanUnverifiedContext) => context.vehicleId,
    delayMs: 24 * 60 * 60 * 1000,
    buildContent: ({ vehicleNo, vehicleId }: VahanUnverifiedContext) => ({
      title: `${vehicleNo} could not be verified`,
      body: `We could not find ${vehicleNo} on Vahan. Check the registration number. Until it is verified you cannot assign this vehicle to a trip.`,
      metadata: {
        vehicle_no: vehicleNo,
        vehicle_id: vehicleId,
        record_kind: 'vehicle',
        record_id: vehicleId,
        cta_label: 'Check the number',
        cta_path: `${MASTER_RECORD_PATHS.vehicle}/${vehicleId}`,
      },
    }),
  },

  // LS_N_0047 — the daily 9:00 IST check (vehicle-document-alerts.ts) sends this at 30, 15, 7, 3
  // and 1 days before a vehicle document's expiry date: in-app + SMS to compliance.manage holders
  // and org admins, at most one per vehicle per day. The sheet's email is the weekly roll-up
  // ('vehicle.documents_expiring_rollup'). Reuses the old placeholder's key so saved
  // notification settings for "Document expiry" carry over.
  'vehicle.document_expiry': {
    label: 'Vehicle document expiring',
    category: 'compliance',
    description:
      'Vehicle RC, insurance, permit, PUC and fitness renewals due in 30, 15, 7, 3 and 1 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['sms'],
    defaultChannels: ['sms'],
    severity: 'p2_action',
    dedupeKey: (context: VehicleDocumentExpiringContext) =>
      `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateDocExpiring,
        variables: { var1: 'doc_type', var2: 'vehicle_no' },
      },
    },
    buildContent: (context: VehicleDocumentExpiringContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const days = `${context.daysLeft} day${context.daysLeft === 1 ? '' : 's'}`;
      return {
        title: `${context.docType} on ${context.vehicleNo} expires in ${days}`,
        body: `${firstName}, ${context.docType} on ${context.vehicleNo} expires on ${context.expiryDate} and ${context.plannedTripCount} trips are already planned after that date. ${context.otherCount} more documents come up this month.`,
        metadata: {
          first_name: firstName,
          doc_type: context.docType,
          vehicle_no: context.vehicleNo,
          days_left: String(context.daysLeft),
          expiry_date: context.expiryDate,
          planned_trip_count: String(context.plannedTripCount),
          other_count: String(context.otherCount),
          vehicle_id: context.vehicleId,
          run_date: context.runDate,
          cta_label: 'Renew documents',
          cta_path: `/masters/vehicles/${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0047's weekly organisation roll-up — email only, every Monday 9:00 IST, to
  // compliance.manage holders + org admins; skipped when nothing expires in the next 30 days.
  'vehicle.documents_expiring_rollup': {
    label: 'Vehicle documents expiring (weekly summary)',
    category: 'compliance',
    description: 'Weekly email listing vehicle documents that expire in the next 30 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: VehicleDocumentsRollupContext) => context.runDate,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateDocRollup,
        variables: { first_name: 'first_name', doc_count: 'doc_count', doc_list: 'doc_list' },
      },
    },
    buildContent: (context: VehicleDocumentsRollupContext, recipient) => ({
      title: `${context.docCount} vehicle documents expiring in the next 30 days`,
      body: context.docList,
      metadata: {
        first_name: firstNameOf(recipient.fullName),
        doc_count: String(context.docCount),
        doc_list: context.docList,
        run_date: context.runDate,
      },
    }),
  },

  // LS_N_0048 — the daily check sends this on the expiry date, then every 7 days while the
  // document stays expired: in-app + push + email + SMS to compliance.manage and
  // dispatch.planning.manage holders and org admins, at most one per vehicle per day. Reuses the
  // retired masters alert's key so saved notification settings carry over. Wording is the
  // sheet's — note dispatch planning currently only WARNS on expired documents.
  'vehicle.compliance_expired': {
    label: 'Vehicle document expired',
    category: 'compliance',
    description: 'A vehicle RC, insurance, permit, PUC or fitness certificate has expired.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => [
      { permission: COMPLIANCE_MANAGE },
      { permission: DISPATCH_PLANNING_MANAGE },
    ],
    channels: ['push', 'email', 'sms'],
    defaultChannels: ['push', 'email', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: VehicleDocumentExpiredContext) =>
      `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateDocExpired,
        variables: { var1: 'vehicle_no', var2: 'doc_type' },
      },
      email: {
        templateId: env.msg91EmailTemplateDocExpired,
        variables: {
          vehicle_no: 'vehicle_no',
          doc_type: 'doc_type',
          expiry_date: 'expiry_date',
          affected_trip_count: 'affected_trip_count',
        },
      },
    },
    buildContent: (context: VehicleDocumentExpiredContext) => {
      const nextTrip = context.nextAffectedTrip;
      const nextTripSentence = nextTrip
        ? ` First one is ${nextTrip.loadCode}${nextTrip.route ? `, ${nextTrip.route}` : ''} on ${nextTrip.pickupDate}${
            nextTrip.transporterName ? ` (${nextTrip.transporterName})` : ''
          }.`
        : '';
      return {
        title: `${context.vehicleNo} is blocked from dispatch`,
        body: `${context.docType} expired on ${context.expiryDate}. ${context.vehicleNo} cannot be assigned to a trip until it is renewed. ${context.affectedTripCount} planned trips need another vehicle.${nextTripSentence}`,
        highlights: [context.vehicleNo, ...(nextTrip ? [nextTrip.loadCode] : [])],
        metadata: {
          vehicle_no: context.vehicleNo,
          doc_type: context.docType,
          expiry_date: context.expiryDate,
          affected_trip_count: String(context.affectedTripCount),
          vehicle_id: context.vehicleId,
          next_load_id: nextTrip?.loadId ?? '',
          next_load_code: nextTrip?.loadCode ?? '',
          next_load_route: nextTrip?.route ?? '',
          next_load_pickup_date: nextTrip?.pickupDate ?? '',
          next_load_transporter: nextTrip?.transporterName ?? '',
          run_date: context.runDate,
          cta_label: 'Reassign those trips',
          cta_path: `/loads?vehicleId=${context.vehicleId}`,
          secondary_cta_label: 'View vehicle',
          secondary_cta_path: `/masters/vehicles/${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0049 (expiring) — the daily 9:00 IST check sends this 30, 15 and 7 days before a
  // driver's licence expires: in-app + push to compliance.manage holders and org admins, at most
  // one per driver per day. Wording agreed separately (the sheet only gives the expired copy).
  // Reuses the old placeholder's key so saved settings for "Driver licence expiry" carry over.
  'driver.licence_expiry': {
    label: 'Driver licence expiring',
    category: 'compliance',
    description: 'Driver licence renewals due in 30, 15 and 7 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: DriverLicenceExpiringContext) =>
      `${context.tenantId}-${context.driverId}-${context.runDate}`,
    buildContent: (context: DriverLicenceExpiringContext) => ({
      title: `${context.driverName}'s licence expires in ${context.daysLeft} days`,
      body: `${licenceRef(context.dlNo)} expires on ${context.expiryDate} and ${context.driverName} is rostered on ${context.tripCount} upcoming trips. Get it renewed or plan another driver.`,
      metadata: {
        driver_name: context.driverName,
        dl_no: context.dlNo ?? '',
        expiry_date: context.expiryDate,
        days_left: String(context.daysLeft),
        trip_count: String(context.tripCount),
        driver_id: context.driverId,
        run_date: context.runDate,
        cta_label: 'Renew licence',
        cta_path: `/masters/drivers/${context.driverId}`,
      },
    }),
  },

  // LS_N_0049 (expired) — on the expiry date only (LS_N_0018 ladder): 9:00 to compliance.manage
  // holders (+ org admins at once if the driver has a pickup today or nobody holds
  // compliance.manage), a reminder to the same people at 11:00, and an escalation to org admins
  // at 13:00 — the reminder and escalation only if the licence still hasn't been renewed.
  'driver.licence_expired': {
    label: 'Driver licence expired',
    category: 'compliance',
    description: 'A driver licence has expired and the driver cannot be assigned.',
    recipientRoles: [],
    recipientPermission: (context: DriverLicenceExpiredContext) =>
      context.stage === 'escalation' ? [] : [{ permission: COMPLIANCE_MANAGE }],
    extraRecipientRoles: (context: DriverLicenceExpiredContext) =>
      context.stage === 'escalation' || context.includeOrgAdmins ? [ORG_ADMIN_ROLE] : [],
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: DriverLicenceExpiredContext) =>
      `${context.tenantId}-${context.driverId}-${context.runDate}-${context.stage}`,
    reminderAfterMs: 2 * 60 * 60 * 1000,
    shouldRemind: (context: DriverLicenceExpiredContext) => context.stage === 'initial',
    templates: {
      sms: { templateId: env.msg91SmsTemplateDlExpired, variables: { var1: 'driver_name' } },
    },
    buildContent: (context: DriverLicenceExpiredContext & { isReminder?: boolean }) => ({
      title: `${context.driverName} cannot be assigned`,
      body: `${licenceRef(context.dlNo)} expired on ${context.expiryDate} and ${context.driverName} is rostered on ${context.tripCount} upcoming trips. Assign another driver or get the licence renewed.`,
      metadata: {
        driver_name: context.driverName,
        dl_no: context.dlNo ?? '',
        expiry_date: context.expiryDate,
        trip_count: String(context.tripCount),
        driver_id: context.driverId,
        run_date: context.runDate,
        ladder_step: context.isReminder ? 'reminder' : context.stage,
        cta_label: 'Reassign trips',
        cta_path: `/loads?driverId=${context.driverId}`,
      },
    }),
  },

  // LS_N_0054 — fired (via breakdown-alerts.ts) when a driver reports a 'breakdown' issue on a
  // trip from the driver app. Immediate (no quiet-hours feature exists to bypass). P1, in-app +
  // push + WhatsApp + SMS to maintenance.manage holders and org admins ("trip.track" skipped).
  'load.breakdown_reported': {
    label: 'Driver marked a breakdown',
    category: 'trip_execution',
    description: 'A driver reported that the vehicle has broken down on a trip.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: BreakdownReportedContext) => context.issueId,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateBreakdown,
        variables: { var1: 'vehicle_no', var2: 'location' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateBreakdown,
        variables: [
          'first_name',
          'vehicle_no',
          'location',
          // The message shows the load code; load_id is the load's UUID (for the inbox card).
          'load_code',
          'driver_name',
          'driver_phone',
        ],
      },
    },
    buildContent: (context: BreakdownReportedContext, recipient) => {
      const t = BREAKDOWN_STATIC_TOKENS;
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      return {
        title: `${vehicleNo} has broken down`,
        body: `${context.driverName} reported ${context.breakdownType} near ${context.location} at ${context.reportTime}, ${t.distanceToDestinationKm} km short of ${context.destination}. Load ${context.loadCode} for ${context.consignee} is on board. Nearest workshop is ${t.workshopName}, ${t.workshopDistanceKm} km away.`,
        metadata: {
          first_name: firstNameOf(recipient.fullName),
          vehicle_no: vehicleNo,
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          breakdown_type: context.breakdownType ?? '',
          location: context.location ?? '',
          report_time: context.reportTime ?? '',
          distance_to_destination: t.distanceToDestinationKm,
          destination: context.destination ?? '',
          load_id: context.loadId,
          load_code: context.loadCode ?? '',
          consignee: context.consignee ?? '',
          workshop_name: t.workshopName,
          workshop_distance: t.workshopDistanceKm,
          load_uuid: context.loadId,
          issue_id: context.issueId,
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          // "+919876500000"; left out when the driver has no valid number.
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
          secondary_cta_label: 'View load details',
          secondary_cta_path: `/loads/${context.loadId}`,
        },
        highlights: [vehicleNo, context.breakdownType ?? ''].filter(Boolean),
      };
    },
  },

  // LS_N_0055 — fired (via the maintenance module's notifications gateway) whenever an open
  // breakdown or workshop/service visit is closed, which always returns the truck to dispatch.
  // In-app only, P3. The repair cost is shown only to recipients who can see maintenance costs.
  'vehicle.back_in_service': {
    label: 'Vehicle back in service',
    category: 'fleet_asset',
    description: 'A vehicle is out of the workshop and available for dispatch again.',
    recipientRoles: [],
    recipientPermission: () => [
      { permission: DISPATCH_PLANNING_MANAGE },
      { permission: MAINTENANCE_MANAGE },
    ],
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: VehicleBackInServiceContext) => context.jobId,
    buildContent: (context: VehicleBackInServiceContext, recipient) => {
      const canSeeCost = !!recipient.id && (context.costViewerIds ?? []).includes(recipient.id);
      const cost = canSeeCost ? `, repair cost ${context.repairCost ?? 'not recorded'}` : '';
      const loadCount = context.loadCount ?? 0;
      const waiting = loadCount === 1 ? '1 load is' : `${loadCount} loads are`;
      return {
        title: `${context.vehicleNo} is back on road`,
        body: `Down for ${context.downtimeHours} hours${cost}. Available for dispatch from ${context.availableFrom}. ${waiting} waiting on your lanes.`,
        metadata: {
          vehicle_id: context.vehicleId ?? '',
          vehicle_no: context.vehicleNo ?? '',
          downtime_hours: context.downtimeHours ?? '',
          available_from: context.availableFrom ?? '',
          load_count: String(loadCount),
          job_id: context.jobId,
          cta_label: 'Assign a load',
          cta_path: `/loads?vehicleId=${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0056 — from the daily 9:00 IST check (service-alerts.ts): once with 10% of the
  // vehicle's service interval left, again at 5%. P3, in-app + SMS.
  'vehicle.service_due_soon': {
    label: 'Service due soon',
    category: 'fleet_asset',
    description: 'A vehicle is close to its service distance, converted into days of running.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    channels: ['sms'],
    defaultChannels: ['sms'],
    severity: 'p3_info',
    dedupeKey: (context: ServiceDueSoonContext) =>
      `${context.vehicleId}-${context.serviceDueKm}-${context.stage}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateServiceDue,
        variables: { var1: 'vehicle_no', var2: 'km_remaining' },
      },
    },
    buildContent: (context: ServiceDueSoonContext) => ({
      title: `${context.vehicleNo} is due for service`,
      body: `${km(context.kmRemaining)} km to the ${context.serviceType} service at ${km(context.serviceDueKm)} km. At its current run of ${km(context.dailyAvgKm)} km a day that is about ${context.daysRemaining} days, and ${context.plannedTripCount} trips are planned in that window.`,
      metadata: {
        vehicle_id: context.vehicleId,
        vehicle_no: context.vehicleNo,
        km_remaining: km(context.kmRemaining),
        service_type: context.serviceType,
        service_due_km: String(context.serviceDueKm),
        daily_avg_km: String(context.dailyAvgKm),
        days_remaining: String(context.daysRemaining),
        planned_trip_count: String(context.plannedTripCount),
        stage: context.stage,
        run_date: context.runDate,
        cta_label: 'Book service',
        cta_path: `/maintenance?vehicleId=${context.vehicleId}`,
      },
    }),
  },

  // LS_N_0057 — from the daily 9:00 IST check: weekly while past the service distance with no
  // service logged. maintenance.manage holders; org admins join after 2 weeks. P2, in-app + push
  // + SMS. The cost sentence is dropped when the org has no costed service/breakdown history.
  'vehicle.service_overdue': {
    label: 'Service overdue',
    category: 'fleet_asset',
    description: 'A vehicle has run past its service distance without a service logged.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    // Org admins hold maintenance.manage via their role — kept out until the 2-week escalation.
    excludeRolesFromPermission: () => [ORG_ADMIN_ROLE],
    extraRecipientRoles: (context: ServiceOverdueContext) =>
      context.escalated ? [ORG_ADMIN_ROLE] : [],
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p2_action',
    dedupeKey: (context: ServiceOverdueContext) => `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: { templateId: env.msg91SmsTemplateServiceOverdue, variables: { var1: 'vehicle_no' } },
    },
    buildContent: (context: ServiceOverdueContext) => {
      const costs =
        context.serviceCost && context.breakdownCost
          ? ` Running past service is what turns a ${context.serviceCost} job into a ${context.breakdownCost} breakdown.`
          : '';
      return {
        title: `${context.vehicleNo} has run ${km(context.kmOverdue)} km past service`,
        body: `The ${context.serviceType} service was due at ${km(context.serviceDueKm)} km and the vehicle is now at ${km(context.currentOdometer)} km.${costs}`,
        metadata: {
          vehicle_id: context.vehicleId,
          vehicle_no: context.vehicleNo,
          km_overdue: String(context.kmOverdue),
          service_type: context.serviceType,
          service_due_km: String(context.serviceDueKm),
          current_odometer: String(context.currentOdometer),
          service_cost: context.serviceCost ?? '',
          breakdown_cost: context.breakdownCost ?? '',
          escalated: String(context.escalated),
          run_date: context.runDate,
          cta_label: 'Book service now',
          cta_path: `/maintenance?vehicleId=${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0059 — weekly (Monday 9:00 IST) roll-up from digests.ts, never an individual alert:
  // owned vehicles with no trip for more than IDLE_DAYS days, headlined by the longest idle.
  // P4, in-app only, to dispatch.planning.manage holders and org admins.
  'vehicle.idle_weekly': {
    label: 'Vehicle idle too long',
    category: 'fleet_asset',
    description: 'Weekly roll-up of owned vehicles that have had no trip for a while.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: DISPATCH_PLANNING_MANAGE }),
    channels: [],
    defaultChannels: [],
    severity: 'p4_digest',
    // Keys are global across tenants (notification-triggers.ts) — the headline vehicle makes it
    // one per organisation per run.
    dedupeKey: (context: VehicleIdleWeeklyContext) => `${context.vehicleId}-${context.runDate}`,
    buildContent: (context: VehicleIdleWeeklyContext) => {
      const cost =
        context.fixedCostPerDay && context.idleCost
          ? ` About ${context.fixedCostPerDay} a day in fixed cost is running against it, ${context.idleCost} so far.`
          : '';
      const others =
        context.otherIdleCount > 0
          ? ` ${plural(context.otherIdleCount, 'other vehicle is', 'other vehicles are')} also free.`
          : '';
      return {
        title: `${context.vehicleNo} has been idle for ${context.idleDays} days`,
        body: `No trip since ${context.lastTripDate}.${cost}${others}`,
        metadata: {
          vehicle_id: context.vehicleId,
          vehicle_no: context.vehicleNo,
          idle_days: String(context.idleDays),
          last_trip_date: context.lastTripDate,
          fixed_cost_per_day: context.fixedCostPerDay ?? '',
          idle_cost: context.idleCost ?? '',
          idle_vehicle_count: String(context.otherIdleCount),
          run_date: context.runDate,
          cta_label: 'See available loads',
          cta_path: '/loads',
        },
      };
    },
  },

  // LS_N_0060 — 07:30 IST Monday–Saturday from digests.ts, one per active org user, each count
  // filtered to that user's permissions; skipped when every count they can see is zero. P4,
  // in-app + WhatsApp (opted-in users only) + email.
  'digest.daily_brief': {
    label: 'Daily morning brief',
    category: 'digest',
    description: 'One morning summary of trips, approvals and vehicles that need you.',
    recipientRoles: [],
    recipientUserId: (context: DailyBriefContext) => context.userId,
    channels: ['whatsapp', 'email'],
    defaultChannels: ['whatsapp', 'email'],
    severity: 'p4_digest',
    requiresWhatsappOptIn: true,
    inAppLatestOnly: true,
    dedupeKey: (context: DailyBriefContext) => `${context.userId}-${context.runDate}`,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateDailyBrief,
        variables: ['first_name', 'trips_running', 'delayed', 'needs_action'],
      },
      email: {
        templateId: env.msg91EmailTemplateDailyBrief,
        variables: {
          first_name: 'first_name',
          org_name: 'org_name',
          needs_action: 'needs_action',
          brief: 'brief',
        },
      },
    },
    buildContent: (context: DailyBriefContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const tasks = [
        context.podsPending !== undefined && `${context.podsPending} PODs pending`,
        context.approvalsPending !== undefined && `${context.approvalsPending} approvals waiting`,
        context.vehiclesBlocked !== undefined &&
          `${context.vehiclesBlocked} vehicles blocked on compliance`,
      ].filter(Boolean);
      const body = [
        `${firstName}, ${context.tripsRunning} trips on road and ${context.arrivingToday} arriving today, ${context.delayed} running late.`,
        tasks.length ? `${tasks.join(', ')}.` : '',
        context.emptyVehicles !== undefined
          ? `${context.emptyVehicles} vehicles free at ${context.idleLocations}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        title: `Your day: ${context.tripsRunning} running, ${context.needsAction} need you`,
        body,
        metadata: {
          first_name: firstName,
          org_name: context.orgName,
          trips_running: String(context.tripsRunning),
          arriving_today: context.arrivingToday,
          delayed: context.delayed,
          needs_action: String(context.needsAction),
          pods_pending: context.podsPending?.toString() ?? '',
          approvals_pending: context.approvalsPending?.toString() ?? '',
          vehicles_blocked: context.vehiclesBlocked?.toString() ?? '',
          empty_vehicles: context.emptyVehicles?.toString() ?? '',
          idle_locations: context.idleLocations ?? '',
          static_tokens: 'arriving_today,delayed,idle_locations',
          brief: body,
          run_date: context.runDate,
          cta_label: 'Open my day',
          cta_path: '/',
        },
      };
    },
  },

  // LS_N_0058 — from the daily 9:00 IST check (tyre-alerts.ts): one message per vehicle rolling
  // up all its tyres in the maintenance tyres queue, when one of them is newly there. P3,
  // in-app + SMS to maintenance.manage holders.
  'vehicle.tyre_attention': {
    label: 'Tyre needs attention',
    category: 'fleet_asset',
    description: 'Tyres that have reached their wear threshold, rolled up per vehicle.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    channels: ['sms'],
    defaultChannels: ['sms'],
    severity: 'p3_info',
    dedupeKey: (context: TyreAttentionContext) => `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateTyreAttention,
        variables: { var1: 'vehicle_no', var2: 'action_type' },
      },
    },
    buildContent: (context: TyreAttentionContext) => {
      const positions = context.tyres.map((tyre) => tyre.position);
      const actions = [...new Set(context.tyres.map((tyre) => tyre.action))];
      const fleet = context.fleetCpk ? ` against a fleet average of ${context.fleetCpk}` : '';
      let body: string;
      const treadClauseOf = (tyre: TyreAttentionContext['tyres'][number]) =>
        tyre.treadMm != null ? `, tread ${tyre.treadMm}mm,` : '';
      if (context.tyres.length === 1) {
        const [tyre] = context.tyres;
        body = `It has run ${km(tyre.km)} km${treadClauseOf(tyre)} and is due for ${tyre.action}.${
          tyre.cpk ? ` Cost per km on this tyre is ${tyre.cpk}${fleet}.` : ''
        }`;
      } else {
        body = `${context.tyres
          .map(
            (tyre) =>
              `${tyre.position} has run ${km(tyre.km)} km${treadClauseOf(tyre)} and is due for ${tyre.action}${
                tyre.cpk ? ` (cost per km ${tyre.cpk})` : ''
              }.`,
          )
          .join(
            ' ',
          )}${context.fleetCpk ? ` Fleet average cost per km is ${context.fleetCpk}.` : ''}`;
      }
      return {
        title:
          context.tyres.length === 1
            ? `Tyre ${positions[0]} on ${context.vehicleNo} needs attention`
            : `Tyres ${positions.join(', ')} on ${context.vehicleNo} need attention`,
        body,
        metadata: {
          vehicle_id: context.vehicleId,
          vehicle_no: context.vehicleNo,
          tyre_position: positions.join(', '),
          tyre_km: context.tyres.map((tyre) => String(tyre.km)).join(','),
          action_type: actions.join(' and '),
          tyre_cpk: context.tyres.map((tyre) => tyre.cpk ?? '').join(','),
          tyre_tread_mm: context.tyres.map((tyre) => tyre.treadMm ?? '').join(','),
          fleet_tyre_cpk: context.fleetCpk ?? '',
          tyre_ids: context.tyres.map((tyre) => tyre.tyreId).join(','),
          run_date: context.runDate,
          cta_label: 'Plan replacement',
          cta_path: `/maintenance?vehicleId=${context.vehicleId}`,
          secondary_cta_label: 'View vehicle',
          secondary_cta_path: `/masters/vehicles/${context.vehicleId}`,
        },
        highlights: [context.vehicleNo],
      };
    },
  },

  // LS_N_0025 — queued by LoadService when the e-way bill is generated, to send
  // EWAY_BILL_ALERT_LEAD_MS (1 hour) before its expiry. The expiry is still the 2-hour placeholder
  // (LoadService.getEwayBillExpiry — no ULIP validity yet), so of the sheet's 12 h / 4 h / 1 h
  // ladder only the 1 h step can happen. At send time the resolver asks tracking for the ETA:
  // skipped if the truck is projected to arrive before the expiry, sent if it's projected after
  // OR tracking has no live ETA (none, or stale — no GPS for 60+ min). Also skipped once delivered or the bill was regenerated. P1 (pings
  // through quiet hours): in-app + push + WhatsApp + SMS to trip.track and compliance.manage.
  'load.eway_bill_expiry': {
    label: 'E-way bill expiry',
    category: 'compliance',
    description: 'The e-way bill expires before the vehicle is projected to reach the destination.',
    recipientRoles: [],
    recipientPermission: () => [{ permission: TRIP_TRACK }, { permission: COMPLIANCE_MANAGE }],
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: EwayBillExpiryContext) => `${context.loadId}-${context.generatedAt}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateEwayBillExpiry,
        variables: { var1: 'vehicle_no' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateEwayBillExpiry,
        variables: ['first_name', 'load_code', 'eway_bill_expiry', 'eta'],
      },
    },
    buildContent: (context: EwayBillExpiryContext, recipient) => {
      const ewayBillLabel = context.ewayBillNumber
        ? `E-way bill ${context.ewayBillNumber}`
        : 'The e-way bill';
      const vehicleNo = context.vehicleNo ?? 'the vehicle';
      const destination = context.destination ?? 'the destination';
      const expiry = formatIndiaDateTime(context.expiresAt);
      const eta = context.etaAt ? formatIndiaDateTime(context.etaAt) : null;
      const arrival = eta
        ? `${vehicleNo} is projected to reach ${destination} at ${eta}`
        : `there's no live ETA for ${vehicleNo} to ${destination} yet`;
      return {
        title: `E-way bill on ${context.loadCode} expires before delivery`,
        body: `${ewayBillLabel} is valid until ${expiry} and ${arrival}. Extend it now. A vehicle moving on a lapsed e-way bill can be detained and penalised.`,
        highlights: [context.ewayBillNumber ?? '', vehicleNo].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          eway_bill_number: context.ewayBillNumber ?? '',
          eway_bill_expires_at: context.expiresAt,
          eway_bill_expiry: expiry,
          destination: context.destination ?? '',
          eta: eta ?? 'not available',
          eta_at: context.etaAt ?? '',
          cta_label: 'Extend e-way bill',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0024 — fired by LoadService.confirmLoading once loading is confirmed (all mandatory
  // documents in), whether by the driver app or staff. One card folding the lorry receipt and
  // e-way bill facts together. In-app only, P3, to trip.track holders. Quantity is the cargo
  // planned on the truck (no loaded weight is captured); the e-way bill validity is the 2-hour
  // placeholder. The button opens the load's documents.
  'load.vehicle_loaded': {
    label: 'Vehicle loaded',
    category: 'trip_execution',
    description: 'Loading is confirmed and the loading documents are uploaded.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: VehicleLoadedContext) => context.loadId,
    buildContent: (context: VehicleLoadedContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const quantity = context.cargoTonnes ? ` ${Number(context.cargoTonnes)} t` : '';
      const documents = context.documentCount
        ? ` and uploaded ${context.documentCount} documents`
        : '';
      // Only the papers actually on the load: "Lorry receipt LR-1 is generated and e-way bill
      // EWB-9 is valid until 16 Oct, 16:30."
      const papers = [
        context.elrNumber
          ? `lorry receipt ${context.elrNumber} is generated`
          : context.hasLorryReceipt
            ? 'the lorry receipt is uploaded'
            : null,
        context.ewayBillNumber
          ? `e-way bill ${context.ewayBillNumber} ${
              context.ewayBillExpiresAt
                ? `is valid until ${formatIndiaDateTime(context.ewayBillExpiresAt)}`
                : 'is uploaded'
            }`
          : null,
      ]
        .filter(Boolean)
        .join(' and ');
      const papersSentence = papers ? ` ${papers.charAt(0).toUpperCase()}${papers.slice(1)}.` : '';
      return {
        title: `${vehicleNo} loaded at ${context.origin ?? 'the loading point'}`,
        body: `${context.confirmedByName ?? 'The driver'} confirmed${quantity} loaded at ${formatIndiaTime(context.loadedAt)}${documents}.${papersSentence}`,
        highlights: [vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          origin: context.origin ?? '',
          driver_name: context.confirmedByName ?? '',
          quantity: context.cargoTonnes ?? '',
          uom: 't',
          loaded_at: context.loadedAt,
          doc_count: String(context.documentCount ?? 0),
          lr_no: context.elrNumber ?? '',
          eway_bill_number: context.ewayBillNumber ?? '',
          eway_bill_expires_at: context.ewayBillExpiresAt ?? '',
          cta_label: 'View lorry receipt',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // 2 h and 1 h before pickup with no tracking — queued when a truck is assigned (load-alerts.ts
  // resolver drops it once the truck is marked at the loading point). Asks the shipper whether the
  // truck has started and reached, and to mark it reached.
  'load.pickup_reminder': {
    label: 'Pickup reminder',
    category: 'trip_execution',
    description: 'Truck not yet marked at the loading point 2 hours and 1 hour before pickup.',
    recipientRoles: [DISPATCH_ROLE, DOCUMENTS_OPS_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: LoadArrivalReminderContext) =>
      `${context.loadId}-${context.leadMinutes}-${context.dueAt}`,
    buildContent: (context: LoadArrivalReminderContext) => {
      const vehicleLabel = context.vehicleNo ?? context.loadCode ?? 'The truck';
      const hours = context.leadMinutes >= 120 ? '2 hours' : '1 hour';
      return {
        title: `Pickup in ${hours}: has ${vehicleLabel} reached?`,
        body: `Load ${context.loadCode} is due for loading at ${formatIndiaTime(context.dueAt)}. Call the driver, then mark the truck started or reached the loading point.`,
        highlights: [vehicleLabel],
        metadata: {
          ...loadMetadataOf(context),
          due_at: context.dueAt,
          cta_label: 'Mark reached',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // 2 h and 1 h before the drop ETA with no tracking — queued when the load is Loaded.
  'load.drop_reminder': {
    label: 'Drop reminder',
    category: 'trip_execution',
    description: 'Truck not yet marked at the unloading point 2 hours and 1 hour before the ETA.',
    recipientRoles: [DISPATCH_ROLE, DOCUMENTS_OPS_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: LoadArrivalReminderContext) =>
      `${context.loadId}-${context.leadMinutes}-${context.dueAt}`,
    buildContent: (context: LoadArrivalReminderContext) => {
      const vehicleLabel = context.vehicleNo ?? context.loadCode ?? 'The truck';
      const hours = context.leadMinutes >= 120 ? '2 hours' : '1 hour';
      return {
        title: `Drop ETA in ${hours}: is ${vehicleLabel} close?`,
        body: `Load ${context.loadCode} is due at the unloading point at ${formatIndiaTime(context.dueAt)}${
          context.consignee ? ` for ${context.consignee}` : ''
        }. Call the driver, then mark the truck reached the unloading point.`,
        highlights: [vehicleLabel],
        metadata: {
          ...loadMetadataOf(context),
          due_at: context.dueAt,
          cta_label: 'Mark reached',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // Loadsmart invoice due in 2 days — queued when Receivables raises it; dropped once the shipper
  // has submitted the payment.
  'load.invoice_due_reminder': {
    label: 'Loadsmart invoice due',
    category: 'money',
    description: "A Loadsmart invoice falls due in 2 days and isn't paid yet.",
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: PAYMENTS_MANAGE }),
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'email'],
    severity: 'p2_action',
    dedupeKey: (context: InvoiceDueContext) => `${context.loadId}-${context.invoiceNumber}`,
    buildContent: (context: InvoiceDueContext) => ({
      title: `Invoice ${context.invoiceNumber} is due on ${context.dueDate}`,
      body: `${context.balanceDue} is due to Loadsmart for load ${context.loadCode ?? ''}. Pay by UPI QR or bank transfer and add the UTR on the load.`,
      highlights: [context.balanceDue],
      metadata: {
        ...loadMetadataOf(context),
        invoice_number: context.invoiceNumber,
        due_date: context.dueDate,
        cta_label: 'Pay invoice',
        cta_path: `/loads/${context.loadId}`,
      },
    }),
  },

  // LS_N_0021 — the trip-timing sweep (every 5 min, trip-timing.ts) sends this when a load is
  // not at the loading point 60 min after its reporting time, then at 3 h and 5 h (3 alerts at most);
  // org admins are added from the 3 h one. The reporting time is the posting's pickup time, or the
  // pickup date at DEFAULT_REPORTING_TIME_IST. Stops as soon as the vehicle reaches the plant
  // (manual "Reached loading point" or tracking's geofence entry). "Last seen" comes from tracking's last
  // position, left out when it has none. P1 (pings through quiet hours): in-app + push + WhatsApp
  // + SMS to trip.track holders plus the user who created the load.
  'load.vehicle_not_reported': {
    label: 'Vehicle not reported for loading',
    category: 'trip_execution',
    description: 'The vehicle is over an hour late reaching the loading point.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    extraRecipientRoles: (context: VehicleNotReportedContext) =>
      context.step >= 1 ? [ORG_ADMIN_ROLE] : [],
    alsoNotifyUserId: (context: VehicleNotReportedContext) => context.createdBy,
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: VehicleNotReportedContext) => `${context.loadId}-${context.step}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateNotReported,
        variables: { var1: 'vehicle_no' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateNotReported,
        variables: [
          'first_name',
          'vehicle_no',
          'delay_duration',
          'origin',
          'load_code',
          'driver_name',
          'driver_phone',
        ],
      },
    },
    buildContent: (context: VehicleNotReportedContext, recipient) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const origin = context.origin ?? 'the loading point';
      const late = durationOf(context.lateMinutes ?? 0);
      const lastSeen =
        context.distanceAwayKm != null || context.lastSeenPlace
          ? ` Last seen${context.distanceAwayKm != null ? ` ${context.distanceAwayKm} km away` : ''}${
              context.lastSeenPlace ? ` near ${context.lastSeenPlace}` : ''
            }.`
          : '';
      const standby =
        context.isOwnFleet || !context.transporterName
          ? 'arrange a standby vehicle'
          : `ask ${context.transporterName} for a standby vehicle`;
      const callDriver = context.driverName
        ? `Call ${context.driverName}${context.driverPhone ? ` on ${context.driverPhone}` : ''} or `
        : context.driverPhone
          ? `Call the driver on ${context.driverPhone} or `
          : '';
      const action = `${callDriver}${standby}.`;
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `${vehicleNo} has not reported at ${origin}`,
        body: `${firstNameOf(recipient.fullName)}, ${vehicleNo} was due at ${origin} by ${formatIndiaDateTime(context.reportingAt)} and is ${late} late.${lastSeen} ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
        highlights: [vehicleNo, late],
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          origin: context.origin ?? '',
          reporting_time: formatIndiaDateTime(context.reportingAt),
          reporting_at: context.reportingAt,
          delay_duration: late,
          distance_away_km: context.distanceAwayKm != null ? String(context.distanceAwayKm) : '',
          last_location: context.lastSeenPlace ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          ladder_step: String(context.step),
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
        },
      };
    },
  },

  // LS_N_0022 — the vehicle reached the loading point: fired by the manual "Reached loading" step
  // (LoadService.updateStatus) or tracking's `trip.arrived_at_pickup` geofence entry (which also
  // moves the load to "Reached loading point"), whichever comes first — once per trip. Early/late is against
  // the reporting time (see DEFAULT_REPORTING_TIME_IST); free time is the company's loading free
  // hours from arrival (auth.organizations, 4 h by default). In-app + push, P3, to trip.track
  // holders.
  'load.vehicle_reached_pickup': {
    label: 'Vehicle reached loading point',
    category: 'trip_execution',
    description: 'The vehicle has arrived at the loading point.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p3_info',
    dedupeKey: (context: VehicleReachedPickupContext) => context.loadId,
    buildContent: (context: VehicleReachedPickupContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      let earlyLate = '';
      if (context.reportingAt) {
        const minutes =
          (new Date(context.arrivedAt).getTime() - new Date(context.reportingAt).getTime()) /
          60_000;
        const timing =
          Math.abs(minutes) < 1
            ? 'on time'
            : minutes < 0
              ? `${durationOf(-minutes)} early`
              : `${durationOf(minutes)} late`;
        earlyLate = `, ${timing} against a reporting time of ${formatIndiaDateTime(context.reportingAt)}`;
      }
      const freeTime = context.freeTimeEndsAt
        ? ` Free loading time ends at ${formatIndiaDateTime(context.freeTimeEndsAt)}.`
        : '';
      return {
        title: `${vehicleNo} has reached ${context.origin ?? 'the loading point'}`,
        body: `Arrived at ${formatIndiaTime(context.arrivedAt)}${earlyLate}.${freeTime}`,
        highlights: [vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          origin: context.origin ?? '',
          arrived_at: context.arrivedAt,
          reporting_at: context.reportingAt ?? '',
          free_time_ends_at: context.freeTimeEndsAt ?? '',
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0023 — the trip-timing sweep sends this once the vehicle has been at the loading point
  // for the company's loading free hours, then every DETENTION_REPEAT_HOURS while it stays. The clock runs from
  // "At plant" (the geofence entry, or the manual tap) until the vehicle leaves: its geofence exit
  // (tracking's departure moves the load to "In transit to unloading") when the geofence saw it arrive, else
  // loading confirmed. Free hours and the rate are the company's (auth.organizations — 4 h and
  // ₹500/h by default). No reason-recording feature exists, so
  // the button opens the load. In-app + push + WhatsApp, P2, to trip.track and payments holders
  // (the sheet's "payment.view").
  'load.detention_at_loading': {
    label: 'Detention started at loading',
    category: 'trip_execution',
    description: 'The vehicle has been at the loading point beyond the free hours.',
    recipientRoles: [],
    recipientPermission: () => [{ permission: TRIP_TRACK }, { permission: PAYMENTS_MANAGE }],
    channels: ['push', 'whatsapp'],
    defaultChannels: ['push', 'whatsapp'],
    severity: 'p2_action',
    dedupeKey: (context: DetentionAtLoadingContext) => `${context.loadId}-${context.step}`,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateDetentionLoading,
        variables: ['first_name', 'vehicle_no', 'origin', 'detention_amount'],
      },
    },
    buildContent: (context: DetentionAtLoadingContext, recipient) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const origin = context.origin ?? 'the loading point';
      return {
        title: `Detention started at ${origin}`,
        body: `${vehicleNo} has been at ${origin} for ${context.hoursAtOrigin} hours against ${context.freeHours} free. ${context.amount} is accruing at ${context.ratePerHour} an hour. Clear the vehicle to stop detention running.`,
        highlights: [vehicleNo, context.amount ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          origin: context.origin ?? '',
          arrived_at: context.arrivedAt,
          detention_hrs: String(context.hoursAtOrigin ?? ''),
          free_hours: String(context.freeHours ?? ''),
          detention_amount: context.amount ?? '',
          rate_per_hour: context.ratePerHour ?? '',
          ladder_step: String(context.step),
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0031 — the vehicle reached the delivery point: fired by the manual "Reached delivery
  // point" step (LoadService.updateStatus) or tracking's `trip.arrived_at_drop` geofence entry
  // (which also moves the load there), whichever comes first — once per trip. Early/late is
  // against the promised delivery: the requisition's expected delivery date (the end of that day —
  // only a date is recorded) or a posted load's "deliver by" time; left out when there's neither.
  // Free time is the customer's free hours at drop, else the
  // company's. In-app + push + SMS, P3, to trip.track holders. Replaces the old generic
  // 'load.stage_handoff' card.
  'load.vehicle_reached_drop': {
    label: 'Vehicle reached unloading point',
    category: 'trip_execution',
    description: 'The vehicle has arrived at the delivery point.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p3_info',
    dedupeKey: (context: VehicleReachedDropContext) => context.loadId,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateReachedDrop,
        variables: { var1: 'vehicle_no', var2: 'consignee' },
      },
    },
    buildContent: (context: VehicleReachedDropContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const consignee = context.consignee ?? 'the delivery point';
      const earlyLate = context.promisedAt
        ? `, ${earlyLateOf(context.arrivedAt, context.promisedAt)} against ${formatIndiaDate(context.promisedAt)}`
        : '';
      const freeTime = context.freeTimeEndsAt
        ? ` Free unloading time ends at ${formatIndiaDateTime(context.freeTimeEndsAt)}.`
        : '';
      return {
        title: `${vehicleNo} reached ${consignee}`,
        body: `Arrived at ${formatIndiaTime(context.arrivedAt)}${earlyLate}.${freeTime}`,
        highlights: [vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          arrival_time: formatIndiaTime(context.arrivedAt),
          arrived_at: context.arrivedAt,
          early_late: context.promisedAt ? earlyLateOf(context.arrivedAt, context.promisedAt) : '',
          promised_date: context.promisedAt ? formatIndiaDate(context.promisedAt) : '',
          promised_at: context.promisedAt ?? '',
          free_time_end: context.freeTimeEndsAt ? formatIndiaDateTime(context.freeTimeEndsAt) : '',
          free_time_ends_at: context.freeTimeEndsAt ?? '',
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0032 — the trip-timing sweep sends this once the vehicle has been at the delivery point
  // for its free hours (the customer's free hours at drop, else the company's), then every
  // DETENTION_REPEAT_HOURS while it stays, up to DETENTION_ALERT_MAX_HOURS. The clock runs from
  // reaching the delivery point until the vehicle leaves: tracking's exit from the drop geofence
  // when the geofence saw it arrive (tracking follows a delivered load until then), else the
  // E-POD. The amount is the hours beyond the free time × the company's rate. The sheet's "Record
  // the reason" button waits for a reason-recording feature — it opens the load for now.
  // In-app + push + WhatsApp, P2, to trip.track and payments holders (the sheet's "payment.view").
  'load.detention_at_unloading': {
    label: 'Detention started at unloading',
    category: 'trip_execution',
    description: 'The vehicle has been at the delivery point beyond the free hours.',
    recipientRoles: [],
    recipientPermission: () => [{ permission: TRIP_TRACK }, { permission: PAYMENTS_MANAGE }],
    channels: ['push', 'whatsapp'],
    defaultChannels: ['push', 'whatsapp'],
    severity: 'p2_action',
    dedupeKey: (context: DetentionAtUnloadingContext) => `${context.loadId}-${context.step}`,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateDetentionUnloading,
        variables: ['first_name', 'vehicle_no', 'consignee', 'detention_amount'],
      },
    },
    buildContent: (context: DetentionAtUnloadingContext, recipient) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const consignee = context.consignee ?? 'the consignee';
      const destination = context.destination ?? context.consignee ?? 'the delivery point';
      return {
        title: `Detention started at ${context.consignee ?? destination}`,
        body: `${vehicleNo} has been at ${destination} for ${context.hoursAtDestination} hours against ${context.freeHours} free. ${context.amount} is billable to ${consignee}.`,
        highlights: [vehicleNo, context.amount ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          destination: context.destination ?? '',
          arrived_at: context.arrivedAt,
          detention_hrs: String(context.hoursAtDestination ?? ''),
          free_hours: String(context.freeHours ?? ''),
          detention_amount: context.amount ?? '',
          ladder_step: String(context.step),
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0033 — the trip is done at the drop: unloading confirmed (the E-POD) and the vehicle has
  // left the delivery point (tracking's exit from the drop geofence), whichever comes last. When
  // there's no exit to wait for (a manual arrival), the E-POD alone completes it; when tracking
  // never reports the exit, TRIP_COMPLETED_FALLBACK_MS after the E-POD. Not the load's "Closed"
  // status (that waits on E-POD review and payments). The sheet's cost line ("Trip closed at
  // {{actual_cost}} against a plan of {{planned_cost}}") waits for trip expenses, which aren't
  // recorded yet. In-app only, P3, to trip.track holders plus the user who created the load.
  'load.trip_completed': {
    label: 'Unloading complete, trip closed',
    category: 'trip_execution',
    description: 'The vehicle has unloaded and left the delivery point.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    alsoNotifyUserId: (context: TripCompletedContext) => context.createdBy ?? null,
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: TripCompletedContext) => context.loadId,
    buildContent: (context: TripCompletedContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const unloaded = context.quantityTonnes
        ? `unloaded ${Number(context.quantityTonnes)} MT`
        : 'unloaded';
      const at = context.consignee ? ` at ${context.consignee}` : '';
      const left = context.departedAt ? ` and left at ${formatIndiaTime(context.departedAt)}` : '';
      return {
        title: `${context.loadCode ?? 'Load'} delivered`,
        body: `${vehicleNo} ${unloaded}${at}${left}.`,
        highlights: [vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          quantity: context.quantityTonnes ?? '',
          uom: context.quantityTonnes ? 'MT' : '',
          departure_time: context.departedAt ? formatIndiaTime(context.departedAt) : '',
          departed_at: context.departedAt ?? '',
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0026 — fired by tracking's `trip.departed_pickup` event (the vehicle left the loading
  // point's geofence), read off the `tracking.events` stream by tracking-events.consumer.ts. ETA
  // and km to run come from tracking's API at send time and are left out when it has none yet.
  // In-app only, P3, to trip.track holders. Nothing sends this until tracking publishes the event.
  'load.vehicle_in_transit': {
    label: 'Vehicle in transit',
    category: 'trip_execution',
    description: 'The vehicle has left the loading point.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: VehicleInTransitContext) => context.loadId,
    buildContent: (context: VehicleInTransitContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const towards = `In transit to ${context.destination ?? 'the destination'}${
        context.consignee ? ` for ${context.consignee}` : ''
      }.`;
      const eta = context.etaAt
        ? ` ETA ${formatIndiaDateTime(context.etaAt)}${
            context.remainingKm != null ? `, ${Math.round(context.remainingKm)} km to run` : ''
          }.`
        : '';
      return {
        title: `${vehicleNo} has left ${context.origin ?? 'the loading point'}`,
        body: `${towards}${eta}`,
        highlights: [vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          origin: context.origin ?? '',
          destination: context.destination ?? '',
          departed_at: context.departedAt,
          eta_at: context.etaAt ?? '',
          distance_km: context.remainingKm != null ? String(Math.round(context.remainingKm)) : '',
          cta_label: 'Track live',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0027 — fired by tracking's HALT-GPS alert (`alert.opened` on the tracking.events stream,
  // tracking-events.consumer.ts), which queues a check at 2 h and at 6 h from the halt's start:
  // one alert per halt, a second only if the same halt crosses 6 hours. Each check sends only if
  // the truck is still standing there, the spot is outside the trip's origin / destination
  // geofences and any rest stop / toll plaza geofence (halt-exclusions.ts), and tracking projects
  // arrival after the promised time. P2, in-app + push to trip.track holders only (no Loadsmart
  // admin).
  'load.vehicle_halted': {
    label: 'Vehicle halted',
    category: 'trip_execution',
    description: 'A vehicle has been stopped for over 2 hours and its ETA is slipping.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: VehicleHaltedContext) =>
      `${context.loadId}-${context.haltAlertId}-${context.step}`,
    buildContent: (context: VehicleHaltedContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const haltDuration = durationOf(context.haltDurationMin ?? 0);
      const haltStart = formatIndiaDateTime(context.haltStartedAt);
      const location = context.location ?? 'its last reported spot';
      const destination = context.destination ?? 'the destination';
      const revisedEta = context.revisedEtaAt ? formatIndiaDateTime(context.revisedEtaAt) : '';
      const delay = context.delayMin != null ? durationOf(context.delayMin) : '';
      const eta = revisedEta
        ? ` ETA at ${destination} has moved to ${revisedEta}${delay ? `, which is ${delay} behind plan` : ''}.`
        : '';
      const driver = context.driverName
        ? ` Driver ${context.driverName}${context.driverPhone ? ` on ${context.driverPhone}` : ''}.`
        : context.driverPhone
          ? ` Driver on ${context.driverPhone}.`
          : '';
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `${vehicleNo} halted for ${haltDuration}`,
        body: `Stopped near ${location} since ${haltStart}.${eta}${driver}`,
        highlights: [vehicleNo, haltDuration],
        metadata: {
          ...loadMetadataOf(context),
          halt_duration: haltDuration,
          location: context.location ?? '',
          halt_start: haltStart,
          halt_started_at: context.haltStartedAt,
          destination: context.destination ?? '',
          revised_eta: revisedEta,
          revised_eta_at: context.revisedEtaAt ?? '',
          delay,
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          halt_alert_id: context.haltAlertId,
          halt_step: context.step,
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          // "+919876500000"; left out when the driver has no valid number.
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
        },
      };
    },
  },

  // LS_N_0028 — tracking's `trip.route_deviation` notice (tracking-events.consumer.ts): more than
  // 15 km off every planned route for 45 min AND heading away from the drop (further from it than
  // 15 min earlier) — so service roads, toll bypasses and diversions closing in on the drop don't
  // fire. One per deviation; tracking re-arms it only after the truck rejoins the corridor. Sent
  // only while the load is still in transit. P2, in-app + push to trip.track holders.
  'load.route_deviation': {
    label: 'Route deviation',
    category: 'trip_execution',
    description: 'A vehicle is far off its planned route and heading away from the destination.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: RouteDeviationContext) =>
      `${context.loadId}-${context.deviationStartedAt}`,
    buildContent: (context: RouteDeviationContext) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const distanceOff = `${Math.round(context.distanceOffKm)}`;
      const location = context.location ?? `${context.lat.toFixed(4)}, ${context.lng.toFixed(4)}`;
      const duration = durationOf(
        context.deviationDurationMin ??
          (Date.now() - new Date(context.deviationStartedAt).getTime()) / MS_PER_MINUTE,
      );
      const revisedEta = context.revisedEtaAt ? formatIndiaDateTime(context.revisedEtaAt) : '';
      const driver = driverContactOf(context.driverName, context.driverPhone);
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `${vehicleNo} is off route`,
        body:
          `${distanceOff} km off the planned route near ${location} for ${duration}.` +
          (revisedEta ? ` ETA is now ${revisedEta}.` : '') +
          ` Check with ${driver || 'the driver'} whether this is a planned diversion.`,
        highlights: [vehicleNo, `${distanceOff} km`],
        metadata: {
          ...loadMetadataOf(context),
          distance_off: distanceOff,
          location,
          deviation_duration: duration,
          deviation_started_at: context.deviationStartedAt,
          revised_eta: revisedEta,
          revised_eta_at: context.revisedEtaAt ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
        },
      };
    },
  },

  // LS_N_0029 — tracking's `trip.signal_lost` notice: a running trip (At plant to delivery) with
  // no position from any source for 4 h; again at 12 h, then once a day. Silence is the failure
  // mode — a dead device otherwise looks like a smooth trip. Sent only while the load is still
  // running and no newer position has arrived. P2, in-app + push + WhatsApp to trip.track holders.
  'load.tracking_signal_lost': {
    label: 'Tracking signal lost',
    category: 'trip_execution',
    description: 'No position has been received from a vehicle on a running trip for hours.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push', 'whatsapp'],
    defaultChannels: ['push', 'whatsapp'],
    severity: 'p2_action',
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateTrackingSignalLost,
        variables: ['first_name', 'vehicle_no', 'hours_since', 'last_location'],
      },
    },
    dedupeKey: (context: TrackingSignalLostContext) =>
      `${context.loadId}-${context.lastSeenAt}-${context.step}`,
    buildContent: (context: TrackingSignalLostContext, recipient) => {
      const vehicleNo = context.vehicleNo ?? 'the vehicle';
      const hoursSince = String(
        context.hoursSince ??
          Math.floor((Date.now() - new Date(context.lastSeenAt).getTime()) / MS_PER_HOUR),
      );
      const lastLocation =
        context.lastLocation ??
        (context.lastLat != null && context.lastLng != null
          ? `${context.lastLat.toFixed(4)}, ${context.lastLng.toFixed(4)}`
          : 'no position yet on this trip');
      const lastPingTime = formatIndiaDateTime(context.lastSeenAt);
      const loadCode = context.loadCode ?? 'the load';
      const destination = context.destination ?? 'the destination';
      const driver = driverContactOf(context.driverName, context.driverPhone);
      const transporter = context.transporterName ?? 'the transporter';
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `No tracking signal from ${vehicleNo}`,
        body:
          `Last position ${lastLocation} at ${lastPingTime}, ${hoursSince} hours ago, on ${loadCode} to ${destination}.` +
          ` Call ${driver || 'the driver'} or ask ${transporter} to check the device.`,
        highlights: [vehicleNo, `${hoursSince} hours`],
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          hours_since: hoursSince,
          last_location: lastLocation,
          last_ping_time: lastPingTime,
          last_seen_at: context.lastSeenAt,
          signal_step: context.step,
          destination: context.destination ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
        },
      };
    },
  },

  // LS_N_0030 — tracking's `trip.delivery_late` notice: the projected ETA is past the committed
  // delivery date by more than the company's limit (Settings, auth.organizations
  // .late_delivery_threshold_minutes; default one day), on two evaluations in a row; again only
  // each time the delay doubles. Sent only while the load is still in transit. P2, in-app + push +
  // WhatsApp + SMS to trip.track holders plus whoever created the load.
  'load.delivery_late': {
    label: 'Delivery will be late',
    category: 'trip_execution',
    description: 'A load is projected to reach its destination well after the committed date.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    alsoNotifyUserId: (context: DeliveryLateContext) => context.createdBy ?? null,
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p2_action',
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateDeliveryLate,
        variables: ['first_name', 'load_code', 'consignee', 'delay', 'revised_eta'],
      },
      sms: {
        templateId: env.msg91SmsTemplateDeliveryLate,
        variables: { var1: 'load_code', var2: 'revised_eta' },
      },
    },
    dedupeKey: (context: DeliveryLateContext) => `${context.loadId}-${context.sequence}`,
    buildContent: (context: DeliveryLateContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const loadCode = context.loadCode ?? 'Your load';
      const destination = context.destination ?? 'its destination';
      const delay = delayOf(context.delayMin);
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const consignee = context.consignee ?? destination;
      const revisedEta = context.etaAt ? formatIndiaDateTime(context.etaAt) : 'not yet known';
      const promisedDate = formatIndiaDateTime(context.promisedAt);
      const reason = delayReasonOf(context);
      return {
        title: `${loadCode} will reach ${destination} ${delay} late`,
        body:
          `${firstName}, ${vehicleNo} is now expected at ${consignee} on ${revisedEta} against a commitment of ${promisedDate}.` +
          ` Main reason: ${reason}. Tell the consignee or move the delivery slot.`,
        highlights: [loadCode, delay],
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstName,
          destination: context.destination ?? '',
          delay,
          delay_minutes: String(context.delayMin),
          revised_eta: revisedEta,
          revised_eta_at: context.etaAt ?? '',
          promised_date: promisedDate,
          promised_at: context.promisedAt,
          delay_reason: reason,
          late_sequence: String(context.sequence),
          cta_label: 'Notify consignee',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0038 — E-POD uploaded (driver app or staff) and waiting for review: fired by
  // LoadService.uploadPod, including a resubmission after rejection (one per upload). Names the
  // transporter balance the review holds up (freight minus advance — market loads only); the
  // sheet's "{{page_count}} pages" is left out (the E-POD is one file; its pages aren't known).
  // P2, in-app + push + SMS + email to E-POD reviewers (loads.documents.manage — the sheet's
  // "pod.verify") plus the user who created the load.
  'load.pod_uploaded': {
    label: 'POD uploaded',
    category: 'pod_billing',
    description: 'An E-POD is waiting for your review.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: LOADS_DOCUMENTS_MANAGE }),
    alsoNotifyUserId: (context: PodUploadedContext) => context.createdBy ?? null,
    channels: ['push', 'sms', 'email'],
    defaultChannels: ['push', 'sms', 'email'],
    severity: 'p2_action',
    dedupeKey: (context: PodUploadedContext) => `${context.loadId}-${context.uploadedAt}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplatePodUploaded,
        variables: { var1: 'load_code' },
      },
      email: {
        templateId: env.msg91EmailTemplatePodUploaded,
        variables: {
          load_id: 'load_code',
          origin: 'origin',
          destination: 'destination',
          driver_name: 'driver_name',
          lr_no: 'lr_no',
          upload_time: 'upload_time',
          amount: 'amount',
        },
      },
    },
    buildContent: (context: PodUploadedContext) => {
      const uploader = context.driverName ?? 'The driver';
      const lr = context.lrNumber ?? 'the lorry receipt';
      const uploadTime = formatIndiaTime(context.uploadedAt);
      const action = context.balanceAmount
        ? `Verify it to release the ${context.balanceAmount} balance${
            context.transporterName ? ` to ${context.transporterName}` : ''
          }.`
        : 'Verify it to close the trip.';
      return {
        title: `POD uploaded for ${context.loadCode}`,
        body: `${uploader} uploaded the POD against ${lr} at ${uploadTime}.${podExceptionSentenceOf(context)} ${action}`,
        highlights: [context.loadCode ?? '', context.balanceAmount ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          driver_name: context.driverName ?? '',
          lr_no: context.lrNumber ?? '',
          upload_time: uploadTime,
          uploaded_at: context.uploadedAt,
          amount: context.balanceAmount ?? '',
          origin: context.origin ?? '',
          destination: context.destination ?? '',
          receiver_name: context.receiverName ?? '',
          quantity_received: context.quantityReceived ?? '',
          tonnes_short: context.tonnesShort ?? '',
          shortage_or_damage: context.shortageOrDamage ?? '',
          cta_label: 'Verify POD',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0039 — no POD in yet: the trip-timing sweep sends this 24 h and 48 h after the vehicle
  // reached the delivery point (in this app the E-POD is what marks a load Delivered), or after a
  // rejected E-POD that hasn't been re-uploaded; at 72 h it goes to org admins only, and after
  // that the daily brief's "PODs pending" count carries it. The amount is the transporter's
  // freight (no customer billing amount exists yet), left out for own-fleet loads. "Chase POD"
  // has no action behind it yet (no cta_path). P2, in-app + push + WhatsApp to E-POD reviewers
  // (loads.documents.manage — the sheet's "pod.verify") and trip.track holders.
  'load.pod_pending': {
    label: 'POD still pending',
    category: 'pod_billing',
    description: 'A delivered load still has no POD, so it cannot be billed.',
    recipientRoles: [],
    recipientPermission: (context: PodPendingContext) =>
      context.step >= POD_PENDING_ALERT_HOURS.length - 1
        ? []
        : [{ permission: LOADS_DOCUMENTS_MANAGE }, { permission: TRIP_TRACK }],
    extraRecipientRoles: (context: PodPendingContext) =>
      context.step >= POD_PENDING_ALERT_HOURS.length - 1 ? [ORG_ADMIN_ROLE] : [],
    channels: ['push', 'whatsapp'],
    defaultChannels: ['push', 'whatsapp'],
    severity: 'p2_action',
    dedupeKey: (context: PodPendingContext) => `${context.loadId}-${context.since}-${context.step}`,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplatePodPending,
        // The message shows the load code; load_id is the load's UUID (for the inbox card).
        variables: ['first_name', 'load_code', 'hours_since', 'amount'],
      },
    },
    buildContent: (context: PodPendingContext, recipient) => {
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      const at = context.consignee ? ` at ${context.consignee}` : '';
      const hours = context.hoursSince ?? POD_PENDING_ALERT_HOURS[context.step];
      const waiting = context.rejected
        ? `The POD from ${vehicleNo}${at} was sent back ${hours} hours ago and no new copy is in.`
        : `${vehicleNo} delivered${at} ${hours} hours ago and no POD is in.`;
      const billing = context.amount ? ` ${context.amount} cannot be billed until it is.` : '';
      const driver = context.driverName
        ? `call ${context.driverName}${context.driverPhone ? ` on ${context.driverPhone}` : ''}`
        : null;
      const chase = [context.transporterName && `chase ${context.transporterName}`, driver]
        .filter(Boolean)
        .join(' or ');
      const chaseSentence = chase ? ` ${chase.charAt(0).toUpperCase()}${chase.slice(1)}.` : '';
      return {
        title: `POD still pending on ${context.loadCode}`,
        body: `${waiting}${billing}${chaseSentence}`,
        highlights: [context.loadCode ?? '', context.amount ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          hours_since: String(hours),
          amount: context.amount ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          pod_rejected: context.rejected ? 'true' : 'false',
          pending_since: context.since,
          cta_label: 'Chase POD',
        },
      };
    },
  },

  // LS_N_0040 — staff rejected the E-POD (LoadService.reviewPod), one per rejection. The reason is
  // the reviewer's own text. "Request a new POD" has no action behind it yet (no cta_path). P2,
  // in-app + push to the user who created the load and trip.track holders.
  'load.pod_rejected': {
    label: 'POD rejected',
    category: 'pod_billing',
    description: 'An E-POD was sent back and the driver needs to upload a clear copy.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    alsoNotifyUserId: (context: PodReviewedContext) => context.createdBy ?? null,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: PodReviewedContext) => `${context.loadId}-${context.reviewedAt}`,
    buildContent: (context: PodReviewedContext) => {
      const driver = context.driverName
        ? `${context.driverName}${context.driverPhone ? ` on ${context.driverPhone}` : ''}`
        : 'the driver';
      return {
        title: `POD on ${context.loadCode} sent back`,
        body: `${context.verifierName ?? 'The reviewer'} rejected the POD. Reason: ${context.reason ?? 'not given'}. Ask ${driver} to upload a clear copy with the consignee stamp and date.`,
        highlights: context.loadCode ? [context.loadCode] : [],
        metadata: {
          ...loadMetadataOf(context),
          verifier_name: context.verifierName ?? '',
          reason: context.reason ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          reviewed_at: context.reviewedAt,
          cta_label: 'Request a new POD',
        },
      };
    },
  },

  // LS_N_0041 — staff accepted the E-POD (LoadService.reviewPod), one per verification. The
  // amount is the transporter's freight (no customer billing amount exists yet), left out for
  // own-fleet loads; the balance line only while a market load's balance is unpaid. "Generate
  // invoice" has no action behind it yet (no invoicing; no cta_path). P3, in-app only, to the
  // user who created the load and payments holders (the sheet's "payment.view").
  'load.pod_verified': {
    label: 'POD verified, clear to bill',
    category: 'pod_billing',
    description: 'An E-POD was approved and the load can be invoiced.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: PAYMENTS_MANAGE }),
    alsoNotifyUserId: (context: PodReviewedContext) => context.createdBy ?? null,
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: PodReviewedContext) => `${context.loadId}-${context.reviewedAt}`,
    buildContent: (context: PodReviewedContext) => {
      const against = context.lrNumber ? ` against ${context.lrNumber}` : '';
      const clear = context.amount
        ? `${context.amount} is clear to invoice`
        : 'The load is clear to invoice';
      const balance = context.balanceDue ? ' and the transporter balance can be released' : '';
      return {
        title: `POD verified on ${context.loadCode}`,
        body: `${context.verifierName ?? 'The reviewer'} approved the POD${against}. ${clear}${balance}.`,
        highlights: [context.loadCode ?? '', context.amount ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          verifier_name: context.verifierName ?? '',
          lr_no: context.lrNumber ?? '',
          amount: context.amount ?? '',
          reviewed_at: context.reviewedAt,
          cta_label: 'Generate invoice',
        },
      };
    },
  },

  // LS_N_0034 — the E-POD recorded a shortage and/or damage against the lorry receipt: once (on
  // the first E-POD that records it), then a reminder CLAIM_REMINDER_DAYS_BEFORE days before the
  // claim window closes (the trip-timing sweep). The window is the company's
  // (auth.organizations.claim_window_days, default 7) from the E-POD; the value at risk is MT
  // short × the cargo value per MT on the requisition/posting, left out when either is unknown
  // (always, for damage only). No claims feature exists yet, so "Raise a claim" opens the load.
  // P1, in-app + push + email to the load's creator, payments holders (the sheet's
  // "payment.view") and org admins.
  'load.shortage_recorded': {
    label: 'Shortage or damage recorded',
    category: 'pod_billing',
    description: 'A short quantity or damage was recorded at unloading — raise a claim in time.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: PAYMENTS_MANAGE }),
    alsoNotifyUserId: (context: ShortageRecordedContext) => context.createdBy ?? null,
    channels: ['push', 'email'],
    defaultChannels: ['push', 'email'],
    severity: 'p1_critical',
    dedupeKey: (context: ShortageRecordedContext) =>
      `${context.loadId}-${context.reminder ? 'reminder' : 'recorded'}`,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateShortageRecorded,
        variables: {
          load_id: 'load_code',
          consignee: 'consignee',
          shortage_qty: 'shortage_qty',
          uom: 'uom',
          lr_no: 'lr_no',
          claim_value: 'claim_value',
          transporter_name: 'transporter_name',
          claim_window_days: 'claim_window_days',
          claim_deadline: 'claim_deadline',
        },
      },
    },
    buildContent: (context: ShortageRecordedContext) => {
      const shortTonnes = context.shortTonnes ? Number(context.shortTonnes) : null;
      const shortage = shortTonnes ? `${shortTonnes} MT short` : 'a shortage';
      const what = context.shortage
        ? `${shortage}${context.damaged ? ' and damage' : ''}`
        : 'damage';
      const lr = context.lrNumber ?? 'the lorry receipt';
      const consignee = context.consignee ?? 'The consignee';
      const withTransporter = context.transporterName ? ` with ${context.transporterName}` : '';
      const atRisk = context.claimValue ? ` Value at risk ${context.claimValue}.` : '';
      const deadline = context.claimDeadline ? formatIndiaDate(context.claimDeadline) : '';
      const title = context.reminder
        ? `Claim window closes in ${CLAIM_REMINDER_DAYS_BEFORE} days on ${context.loadCode}`
        : `${context.shortage ? 'Shortage' : 'Damage'} recorded on ${context.loadCode}`;
      const body = context.reminder
        ? `${CLAIM_REMINDER_DAYS_BEFORE} days left to raise a claim${withTransporter} for the ${what} recorded against ${lr}${context.consignee ? ` at ${context.consignee}` : ''}. The window closes on ${deadline}.${atRisk}`
        : `${consignee} recorded ${what} against ${lr}.${atRisk} Raise a claim${withTransporter} within ${context.claimWindowDays} days or the recovery lapses.`;
      return {
        title,
        body,
        highlights: [context.loadCode ?? '', context.claimValue ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          shortage_qty: shortTonnes ? String(shortTonnes) : '',
          uom: shortTonnes ? 'MT' : '',
          damaged: context.damaged ? 'true' : 'false',
          lr_no: context.lrNumber ?? '',
          claim_value: context.claimValue ?? '',
          claim_window_days: String(context.claimWindowDays ?? ''),
          claim_deadline: deadline,
          claim_deadline_at: context.claimDeadline ?? '',
          reminder: context.reminder ? 'true' : 'false',
          cta_label: 'Raise a claim',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0037 — the driver reported an accident, road block, police/RTO check, strike, bad
  // weather or another problem from the driver app (breakdown-alerts.ts; a breakdown is LS_N_0054,
  // traffic jams and rest stops stay on the timeline). Immediate — P1 rings through quiet hours.
  // The ETA impact is named once something fills the report's eta_impact_minutes (nothing
  // estimates it yet). P1, in-app + push + WhatsApp + SMS to trip.track holders and org admins.
  'load.driver_problem_reported': {
    label: 'Driver reported a problem',
    category: 'trip_execution',
    description:
      'A driver reported a problem on a trip — accident, road block, police check and more.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: DriverProblemReportedContext) => context.issueId,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateDriverProblem,
        variables: { var1: 'load_code' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateDriverProblem,
        variables: ['first_name', 'driver_name', 'issue_type', 'load_code', 'location'],
      },
    },
    buildContent: (context: DriverProblemReportedContext, recipient) => {
      const driverName = context.driverName ?? 'The driver';
      const issueType = DRIVER_PROBLEM_LABELS[context.category ?? 'other'] ?? 'a problem';
      const location = context.location ?? 'an unknown location';
      const reportTime = context.reportedAt ? formatIndiaTime(context.reportedAt) : '';
      const note = context.driverNote
        ? ` ${context.driverNote}${/[.!?]$/.test(context.driverNote) ? '' : '.'}`
        : '';
      const etaImpact =
        context.etaImpactMinutes != null
          ? ` ETA impact about ${durationOf(context.etaImpactMinutes)}.`
          : '';
      const phone = context.driverPhone ? ` Driver on ${context.driverPhone}.` : '';
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `${driverName} reported ${issueType} on ${context.loadCode}`,
        body: `Reported near ${location}${reportTime ? ` at ${reportTime}` : ''}.${note}${etaImpact}${phone}`,
        highlights: [issueType, context.loadCode ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          first_name: firstNameOf(recipient.fullName),
          issue_id: context.issueId,
          issue_type: issueType,
          issue_category: context.category ?? '',
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          location: context.location ?? '',
          report_time: reportTime,
          reported_at: context.reportedAt ?? '',
          driver_note: context.driverNote ?? '',
          eta_impact: context.etaImpactMinutes != null ? durationOf(context.etaImpactMinutes) : '',
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
          // "+919876500000"; left out when the driver has no valid number.
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
        },
      };
    },
  },

  // Transporter advance due — fired when a market/indent load goes in transit (loading
  // confirmed, which is when an advance can first be recorded) and no advance is paid yet.
  // In-app + push to payments.manage holders, P2.
  'load.advance_due': {
    label: 'Advance payment due',
    category: 'money',
    description: "A transporter's advance can be released for a load in transit.",
    ctaStyle: 'primary',
    // LS_N_0042: payments approvers plus org admin, P1 (the truck is held), In app/Push/Email/SMS,
    // reminder at 4 hours while still unpaid (the resolver drops it once the advance is paid).
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: PAYMENTS_MANAGE }),
    channels: ['push', 'email', 'sms'],
    defaultChannels: ['push'],
    severity: 'p1_critical',
    reminderAfterMs: 4 * 60 * 60 * 1000,
    dedupeKey: (context: AdvanceDueContext) => context.loadId,
    buildContent: (context: AdvanceDueContext) => {
      const amountLabel = context.amount ?? 'The';
      const advanceShareLabel = context.advancePercentage
        ? `${Number(context.advancePercentage)}%`
        : 'the';
      const payeeAccountLabel = [
        context.bankName,
        context.accountLast4 ? `••${context.accountLast4}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        title: `Advance of ${amountLabel} requested on ${context.loadCode}`,
        body: `${context.transporterName ?? 'The transporter'} is due ${advanceShareLabel} advance${
          context.route ? ` on ${context.route}` : ''
        }${context.vehicleNo ? ` (${context.vehicleNo})` : ''}. Loading is confirmed.${
          payeeAccountLabel ? ` Pay to ${payeeAccountLabel}.` : ''
        }`,
        highlights: [context.amount, context.vehicleNo].filter((highlight): highlight is string =>
          Boolean(highlight),
        ),
        metadata: {
          ...loadMetadataOf(context),
          advance_percentage: context.advancePercentage ?? '',
          advance_amount: context.amount ?? '',
          bank_name: context.bankName ?? '',
          bank_account_last4: context.accountLast4 ?? '',
          cta_label: 'Approve advance',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0050 — after any assignment (the same 'assigned' event as LS_N_0016): the driver's licence
  // doesn't cover the vehicle (over 7,500 kg needs a transport class — TRANS / HGMV / HMV / HTV /
  // HPMV / MGV) or the cargo (a hazardous product needs the 'hazmat' endorsement). Rules and
  // sources in licence-check.ts. Only a confirmed mismatch alerts: no Sarathi class or no vehicle
  // weight on file skips the class check. Doesn't change whether the assignment is allowed. P1,
  // in-app + push to dispatch planners (the sheet's "dispatch.plan") and masters writers (who can
  // add a driver — the sheet's "driver.manage"). One per assignment.
  'load.licence_mismatch': {
    label: 'Licence class does not match the vehicle',
    category: 'compliance',
    description: "The assigned driver's licence doesn't cover the vehicle or the cargo.",
    recipientRoles: [],
    recipientPermission: () => [
      { permission: DISPATCH_PLANNING_MANAGE },
      { permission: MASTERS_WRITE },
    ],
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p1_critical',
    dedupeKey: (context: LicenceMismatchContext) => `${context.loadId}-${context.assignedAt}`,
    buildContent: (context: LicenceMismatchContext) => {
      const driverName = context.driverName ?? 'The driver';
      const vehicleNo = context.vehicleNo ?? 'the vehicle';
      const products = (context.hazardousProducts ?? []).join(', ');
      const heldClass = context.licenceClass ?? 'a licence';
      const transportRequirement = `a transport licence (it is over ${LMV_MAX_GROSS_WEIGHT_KG.toLocaleString('en-IN')} kg)`;
      const hazmatRequirement = `a hazardous goods endorsement for ${products}`;
      const licenceRequirement =
        context.needsTransportClass && context.needsHazmatEndorsement
          ? `${transportRequirement} and ${hazmatRequirement}`
          : context.needsTransportClass
            ? transportRequirement
            : hazmatRequirement;
      const body = context.needsTransportClass
        ? `${driverName} holds ${heldClass}${
            context.needsHazmatEndorsement ? ' with no hazardous goods endorsement' : ''
          } and ${vehicleNo} needs ${licenceRequirement}.`
        : `${driverName} has no hazardous goods endorsement and ${vehicleNo} is carrying ${products}.`;
      return {
        title: `${driverName} is not licensed for ${vehicleNo}`,
        body: `${body} Assign a driver with the right class before the vehicle moves.`,
        highlights: [driverName, vehicleNo],
        metadata: {
          ...loadMetadataOf(context),
          driver_name: context.driverName ?? '',
          licence_class: context.licenceClass ?? '',
          licence_requirement: licenceRequirement,
          gross_vehicle_weight_kg:
            context.grossVehicleWeightKg != null ? String(context.grossVehicleWeightKg) : '',
          needs_transport_class: context.needsTransportClass ? 'true' : 'false',
          needs_hazmat_endorsement: context.needsHazmatEndorsement ? 'true' : 'false',
          hazardous_products: products,
          cta_label: 'Change driver',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0016 — fired after any assignment: market Load Assignment (LoadService.assign), own-fleet
  // Dispatch Planning and own-fleet Post a load. A vehicle or driver with an expired document is
  // refused before this (LS_N_0017), so the compliance line only ever says clear or not checked.
  // In-app + push + SMS to trip.track holders plus the user who created the load, P3. No load memo
  // exists yet, so the button opens the load.
  'load.vehicle_assigned': {
    label: 'Truck and driver assigned',
    category: 'trip_execution',
    description: 'A vehicle and driver have been assigned to a load.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: TRIP_TRACK }),
    alsoNotifyUserId: (context: VehicleAssignedContext) => context.createdBy,
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p3_info',
    dedupeKey: (context: VehicleAssignedContext) => `${context.loadId}-${context.assignedAt}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateVehicleAssigned,
        variables: { var1: 'vehicle_no', var2: 'load_code' },
      },
    },
    buildContent: (context: VehicleAssignedContext) => {
      const vehicleNo = context.vehicleNo ?? 'A vehicle';
      const driverPart = context.driverName
        ? ` with driver ${context.driverName}${context.driverPhone ? ` on ${context.driverPhone}` : ''}`
        : context.driverPhone
          ? ` with driver on ${context.driverPhone}`
          : '';
      const givenBy = context.isOwnFleet
        ? `${vehicleNo} from your fleet is assigned${driverPart}.`
        : `${context.transporterName ?? 'The transporter'} has given ${vehicleNo}${driverPart}.`;
      const reporting = context.reportingTime
        ? ` Reporting at ${context.origin ?? 'the loading point'} by ${context.reportingTime}.`
        : '';
      const driverDialNumber = toInternationalIndianNumber(context.driverPhone);
      return {
        title: `${vehicleNo} assigned to ${context.loadCode}`,
        body: `${givenBy}${reporting} ${assignmentComplianceSentenceOf(context)}`,
        highlights: [vehicleNo, context.loadCode ?? ''].filter(Boolean),
        metadata: {
          ...loadMetadataOf(context),
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          origin: context.origin ?? '',
          reporting_time: context.reportingTime ?? '',
          vehicle_checked: String(context.vehicleChecked),
          driver_checked: String(context.driverChecked),
          assigned_at: context.assignedAt,
          ...(driverDialNumber ? { cta_phone: driverDialNumber } : {}),
          cta_label: 'View load',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0017 — fired when an assignment is refused because the vehicle has an expired RC,
  // insurance, permit, PUC, fitness or road tax, or the driver's licence has expired, per the
  // masters (no live ULIP Vahan/Sarathi lookup exists): market Load Assignment, own-fleet Dispatch
  // Planning or own-fleet Post a load. P1, so it pings through quiet hours: in-app + push +
  // WhatsApp + SMS to trip.track and compliance.manage holders and org admins. One reminder after
  // 60 minutes escalates to org admins only, unless the document was renewed or the load (or
  // requisition) has since been given another vehicle. Retrying the same blocked vehicle within
  // the hour doesn't send it again.
  'load.assignment_compliance_failed': {
    label: 'Assigned vehicle fails compliance',
    category: 'compliance',
    description:
      'A vehicle or driver with an expired document was stopped from being assigned to a load.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: (context: AssignmentComplianceFailedContext & { isReminder?: boolean }) =>
      context.isReminder ? [] : [{ permission: TRIP_TRACK }, { permission: COMPLIANCE_MANAGE }],
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: AssignmentComplianceFailedContext) => assignmentBlockKeyOf(context),
    reminderAfterMs: ASSIGNMENT_BLOCK_ALERT_WINDOW_MS,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateAssignmentCompliance,
        variables: { var1: 'vehicle_no' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateAssignmentCompliance,
        variables: ['first_name', 'vehicle_no', 'reference_code', 'doc_type', 'transporter_name'],
      },
    },
    buildContent: (
      context: AssignmentComplianceFailedContext & { isReminder?: boolean },
      recipient,
    ) => {
      const isDriver = context.subject === 'driver';
      const expiredWhat = isDriver
        ? `${context.driverName ? `${context.driverName}'s` : "The driver's"} driving licence for ${context.vehicleNo}`
        : `${context.docType} on ${context.vehicleNo}`;
      const heldWhat = context.referenceCode
        ? `${context.referenceCode}${context.route ? `, ${context.route}` : ''}`
        : `the new load${context.route ? ` from ${context.route}` : ''}`;
      const replacement = isDriver ? 'driver' : 'vehicle';
      const ask = context.transporterName
        ? `Ask ${context.transporterName} for a replacement ${replacement}`
        : `Assign another ${replacement}`;
      const deadline = context.reportingTime ? ` before ${context.reportingTime}` : '';
      const ctaPath = context.loadId
        ? `/loads/${context.loadId}`
        : context.requisitionId
          ? `/requisitions/${context.requisitionId}`
          : '/loads';
      return {
        title: `${context.vehicleNo} cannot be dispatched`,
        body: `${context.isReminder ? 'Still not resolved after an hour. ' : ''}${expiredWhat} expired on ${context.expiryDate}. We have held the assignment for ${heldWhat}. ${ask}${deadline}.`,
        highlights: [context.vehicleNo, context.referenceCode ?? ''].filter(Boolean),
        metadata: {
          first_name: firstNameOf(recipient.fullName),
          load_id: context.loadId ?? '',
          requisition_id: context.requisitionId ?? '',
          reference_code: context.referenceCode ?? '',
          vehicle_no: context.vehicleNo,
          vehicle_id: context.vehicleId ?? '',
          driver_id: context.driverId ?? '',
          driver_name: context.driverName ?? '',
          compliance_subject: context.subject,
          doc_type: context.docType,
          expiry_date: context.expiryDate,
          transporter_name: context.transporterName ?? '',
          route: context.route ?? '',
          origin: context.origin ?? '',
          destination: context.destination ?? '',
          reporting_time: context.reportingTime ?? '',
          blocked_at: context.blockedAt,
          block_key: assignmentBlockKeyOf(context),
          ladder_step: context.isReminder ? 'escalation' : 'initial',
          cta_label: 'Ask for a replacement',
          cta_path: ctaPath,
        },
      };
    },
  },

  'driver.link_requested': {
    label: 'Driver join request',
    category: 'drivers',
    description: 'A driver has requested to join your fleet.',
    recipientRoles: [ORG_ADMIN_ROLE, DISPATCH_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'email'],
    severity: 'p2_action',
    buildContent: (
      { driverId, driverName, phoneNumber }: DriverLinkContext,
      _recipient,
      locale = DEFAULT_LOCALE,
    ) => ({
      title: t(locale, 'notifications.driverLinkRequested.title'),
      body: t(locale, 'notifications.driverLinkRequested.body', { driverName, phoneNumber }),
      ...(driverId ? { metadata: { driver_id: driverId } } : {}),
    }),
  },
  'driver.link_accepted': {
    label: 'Driver invite accepted',
    category: 'drivers',
    description: 'A driver has accepted your invitation to join your fleet.',
    recipientRoles: [ORG_ADMIN_ROLE, DISPATCH_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'email'],
    severity: 'p3_info',
    buildContent: (
      { driverId, driverName, phoneNumber }: DriverLinkContext,
      _recipient,
      locale = DEFAULT_LOCALE,
    ) => ({
      title: t(locale, 'notifications.driverLinkAccepted.title'),
      body: t(locale, 'notifications.driverLinkAccepted.body', { driverName, phoneNumber }),
      ...(driverId ? { metadata: { driver_id: driverId } } : {}),
    }),
  },
  'driver.account_deleted': {
    label: 'Driver account deleted',
    category: 'drivers',
    description: 'A linked driver has deleted their account and been disconnected from your fleet.',
    recipientRoles: [ORG_ADMIN_ROLE, DISPATCH_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'email'],
    severity: 'p3_info',
    buildContent: (
      { driverName, phoneNumber }: DriverLinkContext,
      _recipient,
      locale = DEFAULT_LOCALE,
    ) => ({
      title: t(locale, 'notifications.driverAccountDeleted.title'),
      body: t(locale, 'notifications.driverAccountDeleted.body', { driverName, phoneNumber }),
    }),
  },
} satisfies Record<string, NotificationTypeDefinition<any>>;

/** Per-type MSG91 template config for the channels (see channels/*.channel.ts) — undefined for a
 *  type with none, which keeps each channel on its env-level default template. */
export function getNotificationTemplates(type: string): NotificationTemplates | undefined {
  return (NOTIFICATION_CATALOG as Record<string, { templates?: NotificationTemplates }>)[type]
    ?.templates;
}

/** Types stored but never shown in the app (`inApp: false`) — excluded by the in-app read
 *  endpoints (see notifications.service.ts). */
export const IN_APP_HIDDEN_TYPES: string[] = Object.entries(
  NOTIFICATION_CATALOG as Record<string, { inApp?: boolean }>,
)
  .filter(([, definition]) => definition.inApp === false)
  .map(([key]) => key);

/** Types the inbox shows only the newest of, per recipient (see inAppLatestOnly). */
export const IN_APP_LATEST_ONLY_TYPES: string[] = Object.entries(
  NOTIFICATION_CATALOG as Record<string, { inAppLatestOnly?: boolean }>,
)
  .filter(([, definition]) => definition.inAppLatestOnly === true)
  .map(([key]) => key);

/** Builds a template's `{ templateVar: value }` payload from the notification's metadata. */
export function mapTemplateVariables(
  mapping: Record<string, string>,
  metadata: Record<string, unknown> | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).map(([templateVar, key]) => [
      templateVar,
      String(metadata?.[key] ?? ''),
    ]),
  );
}
