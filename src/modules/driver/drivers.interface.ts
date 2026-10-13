import {
  DriverBankVerificationStatus,
  DriverBloodGroup,
  DriverEngagementType,
  DriverDocumentType,
  DriverDocumentVerificationSource,
  DriverOnboardingStep,
  DriverOperationalStatus,
  DriverRegistrationSource,
  DriverSalaryType,
  DriverTenantRelationInitiator,
  DriverTenantRelationStatus,
  DriverVerificationStatus,
  DriverVerificationType,
  DriverInsuranceAnswer,
  DriverInvitationExpiryReason,
  DriverInvitationStatus,
  DriverInviteDeliveryStatus,
  DriverLicenseEndorsement,
  DriverRosterSegment,
} from './drivers.types';
import { Paginated, PaginationInput } from '../../shared/utils/pagination';
import { DriverEntity } from './entities/driver.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateDriverInput {
  // Optional — onboardDriver fills it from the Sarathi lookup; required only to create a new
  // profile when the lookup returned no name.
  fullName?: string;
  phoneNumber: string;
  licenseNumber: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
  dateOfBirth: string;
  bloodGroup?: DriverBloodGroup;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  salaryType?: DriverSalaryType;
  salaryAmount?: number;
  engagementType?: DriverEngagementType;
  bhattaPerDay?: number;
  advanceOutstanding?: number;
  homeBase?: string;
  licenseEndorsements?: DriverLicenseEndorsement[];
  hasHealthInsurance?: DriverInsuranceAnswer;
  hasLifeInsurance?: DriverInsuranceAnswer;
  // Set by onboardDriver itself (never from the request body) — `completed` once the form carries
  // everything the driver app's registration needs, so the app skips its wizard.
  onboardingStep?: DriverOnboardingStep;
}

export interface UpdateDriverInput {
  fullName?: string;
  phoneNumber?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  bloodGroup?: DriverBloodGroup;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  salaryType?: DriverSalaryType;
  salaryAmount?: number;
  engagementType?: DriverEngagementType;
  bhattaPerDay?: number;
  advanceOutstanding?: number;
  homeBase?: string;
  licenseEndorsements?: DriverLicenseEndorsement[];
}

export interface ListDriversInput extends PaginationInput {
  status?: DriverTenantRelationStatus;
  initiatedBy?: DriverTenantRelationInitiator;
  operationalStatus?: DriverOperationalStatus;
  /** "Active Roster" tab — see DRIVER_ROSTER_SEGMENTS. Omitted = no segment narrowing. */
  segment?: DriverRosterSegment;
  search?: string;
}

/** Tab-bar badge counts — each under the same status/initiatedBy/search filters as the list. */
export type DriverRosterCounts = Record<DriverRosterSegment, number> & {
  /** Every driver under those filters, left-the-company included — the "of 45" in "44 of 45". */
  total: number;
};

/** "Invitations Sent" list — tenant-initiated invites, optionally narrowed to one display status. */
export interface ListInvitationsInput extends PaginationInput {
  status?: DriverInvitationStatus;
  /** Digits only, partial allowed — names aren't unique, so the tab searches by mobile alone. */
  phoneNumber?: string;
}

/** POST /drivers/invitations — the Invitations tab's "Invite by mobile number". */
export interface InviteDriverByPhoneInput {
  phoneNumber: string;
}

/**
 * Result of an invite by mobile number. org_admin's invite goes straight out (`invitation` set);
 * dispatch's waits for an org_admin to approve it (`awaitingApproval`, `invitation` null — it
 * joins Invitations Sent once approveDriver sends it).
 */
export interface InviteDriverByPhoneResult {
  driverId: string;
  invitationId: string;
  awaitingApproval: boolean;
  invitation: DriverInvitationView | null;
}

export interface DriverInvitationDeliveryChannel {
  channel: 'sms' | 'whatsapp' | 'push';
  status: DriverInviteDeliveryStatus | null;
  statusAt: Date | null;
}

/** One row of the "Invitations Sent" table. */
export interface DriverInvitationView {
  invitationId: string;
  /** Sequential "Req ID", e.g. INV-00042. */
  requestId: string;
  driverId: string;
  fullName: string;
  phoneNumber: string;
  status: DriverInvitationStatus;
  /** Set only when status is `expired`. */
  expiredReason: DriverInvitationExpiryReason | null;
  sentAt: Date;
  expiresAt: Date | null;
  respondedAt: Date | null;
  rejectionReason: string | null;
  /** How the latest send went out, per channel. */
  deliveryChannels: DriverInvitationDeliveryChannel[];
  /** Whether the driver has ever logged into the driver app — false for a number invited before
   *  its owner installed it. */
  appInstalled: boolean;
}

/** Invitation detail drawer — the list row plus credentials, timeline and delivery channels. */
export interface DriverInvitationDetailView extends DriverInvitationView {
  credentials: {
    licenseNumber: string | null;
    licenseClass: string | null;
    /** Latest Sarathi DL check; null when the licence was never checked. */
    registry: DriverRegistryCheck | null;
  };
  timeline: DriverInvitationTimelineStep[];
}

/**
 * Latest send only: sent → viewed (once the driver opened the invite notification) → one final
 * step derived from the relation's status (accepted / rejected / cancelled / expired /
 * awaiting_response). `cancelled.at` is the relation's last update — the cancel itself, since a
 * cancelled invite can't be changed afterwards.
 */
export type DriverInvitationTimelineStep =
  | { step: 'sent'; at: Date; by: { name: string | null; role: string | null } | null }
  | { step: 'viewed'; at: Date; device: string | null }
  | { step: 'accepted'; at: Date | null }
  | { step: 'rejected'; at: Date | null; reason: string | null }
  | { step: 'expired'; at: Date | null }
  | { step: 'cancelled'; at: Date }
  | { step: 'awaiting_response'; at: null };

/** Latest Sarathi DL check on the driver; null when the licence was never checked. */
export interface DriverRegistryCheck {
  source: 'sarathi';
  status: DriverVerificationStatus;
  checkedAt: Date | null;
}

/** Driver detail → "Licence credentials" card (also a roster row's Licence column). */
export interface DriverLicenceSection {
  number: string | null;
  classOfVehicle: string | null;
  /** Endorsement codes, e.g. ['hazmat']; [] when none. */
  endorsements: DriverLicenseEndorsement[];
  validTo: string | null;
  /** Whole days until licenseExpiry (negative once expired); null when no expiry is on file. */
  daysLeft: number | null;
  registry: DriverRegistryCheck | null;
  /** Active link to this tenant, licence verified and not expired. */
  eligibleToDrive: boolean;
}

export interface DriverEmergencyContact {
  name: string | null;
  phone: string;
  relation: string | null;
}

/** "Compensation package" — monthly pay plus daily bhatta. */
export interface DriverCompensation {
  salaryType: DriverSalaryType | null;
  salaryAmount: string | null;
  /** Daily bhatta on a trip — null until set on the driver. */
  bhattaPerDay: string | null;
}

/** Driver detail → "Contact & engagement" card. */
export interface DriverContactSection {
  primaryMobile: string;
  bloodGroup: DriverBloodGroup | null;
  emergencyContact: DriverEmergencyContact | null;
  /** On-roll salaried / per trip / vendor's driver — null until set on the driver. */
  engagementType: DriverEngagementType | null;
  dateOfJoining: string | null;
  tenureYears: number | null;
  /** Hand-entered balance of advances not yet recovered; null until set. */
  advanceOutstanding: string | null;
  compensation: DriverCompensation;
}

export interface DriverTruckTypeSummary {
  id: string;
  name: string;
}

/** The driver's active primary vehicle in this tenant. */
export interface DriverAssignedVehicle {
  id: string;
  registrationNumber: string;
  truckType: DriverTruckTypeSummary | null;
}

export interface DriverAssignmentSection {
  vehicle: DriverAssignedVehicle | null;
  /** Yard/branch the driver operates from; null until set. */
  homeBase: string | null;
}

/** The driver's newest non-closed load — the live "on a trip" check. */
export interface DriverActiveLoadSummary {
  id: string;
  code: string;
  status: string;
}

/** Driver detail → "Availability" card (also a roster row's Availability column). */
export interface DriverAvailabilitySection {
  /** Stored company status; can lag reality since load assignment doesn't update it. */
  operationalStatus: DriverOperationalStatus | null;
  /** Live check — the driver's newest non-closed load. */
  activeLoad: DriverActiveLoadSummary | null;
  dispatchable: boolean;
}

/** Driver detail → "Performance" card (also a roster row's Trips · On time / Score columns). */
export interface DriverPerformanceSection {
  totalTrips: number;
  onTimePercentage: number | null;
  /** No scoring model exists yet. */
  driverScore: null;
  /** The score badge to show. `new` until the driver has MIN_SCORED_TRIPS trips and a score — a
   *  freshly added driver is neutral, never `watch`. */
  scoreStatus: DriverScoreStatus;
}

export type DriverScoreStatus = 'new' | 'strong' | 'watch';

/**
 * Driver detail screen sections — added on top of the flattened driver by GET /drivers/{id} so
 * the whole screen loads in one call. Fields typed `null`/`[]`-only have no backing data yet;
 * their shapes are fixed here so the frontend can build against them before the data exists.
 */
export interface DriverDetailSections {
  licence: DriverLicenceSection;
  contact: DriverContactSection;
  assignment: DriverAssignmentSection;
  availability: DriverAvailabilitySection;
  performance: DriverPerformanceSection;
  /** Whether the driver has ever logged into the driver app (any driver_sessions row, revoked or
   *  expired included) — the roster's phone icon. Uninstalls can't be detected server-side. */
  appInstalled: boolean;
  /** Latest app activity across all of the driver's sessions; null if never logged in. */
  appLastSeenAt: Date | null;
  /** Future shape: `{ from, to, laneType, distanceKm }[]` — no lane/distance data yet. */
  knownLanes: never[];
  /** Future shape: `{ event: 'over_speeding' | 'harsh_braking' | 'harsh_acceleration' |
   *  'night_driving', per1000Km, fleetComparison }[]` — no telematics events yet. */
  behaviour: null;
  /** Future shape: `{ loadId, code, status, from, to, date, progressPercentage }[]` — no SLA
   *  data yet. */
  slaBreachTrips: never[];
}

/**
 * The flattened, tenant-facing shape of a driver: the global profile (fullName, phoneNumber,
 * dateOfJoining, salaryType/Amount, documents, verifications, bankDetails — all person-level, one
 * job at a time) with this tenant's DriverTenantRelationEntity fields (status, initiatedBy,
 * approvedBy/At, rejectionReason — the link's own approval-workflow state) and satellites
 * (operationalStatus, tripMetrics, vehicleLinks) spread on top — so existing API consumers see the
 * same response shape they always did, even though the data now lives across two tables. `id`
 * stays the driver's global id (the same value that's always been in the :driverId URL param);
 * `driverTenantRelationId` is the new row backing the approval fields, exposed for callers that
 * need it (e.g. accept/reject an invite).
 */
export interface DriverWithRelation extends Omit<DriverEntity, 'tenantRelations'> {
  driverTenantRelationId: string;
  tenantId: string;
  status: DriverTenantRelationStatus;
  initiatedBy: DriverTenantRelationInitiator;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  /** When this tenant link was created — the "Requested 2 days ago" timestamp. `createdAt` is the
   * global driver profile's, which predates the request for a driver already on the platform. */
  requestedAt: Date;
  /** Latest `driver_verifications.license_class` (e.g. "HTV Heavy Transport"); null when the
   * verifications weren't loaded or none carries a class. */
  licenseClass: string | null;
  operationalStatus?: DriverOperationalStatusEntity;
  tripMetrics?: DriverTripMetricsEntity[];
  vehicleLinks?: DriverTenantRelationEntity['vehicleLinks'];
}

/** GET /drivers/{id} — the flattened driver plus every section of the driver detail screen. */
export type DriverDetailView = DriverWithRelation & DriverDetailSections;

/** One My Drivers roster row — the list's driver plus the detail sections its columns read. */
export type DriverRosterRow = DriverWithRelation &
  Pick<
    DriverDetailSections,
    | 'licence'
    | 'contact'
    | 'assignment'
    | 'availability'
    | 'performance'
    | 'behaviour'
    | 'appInstalled'
    | 'appLastSeenAt'
  >;

/** GET /drivers — the paginated roster plus every tab's badge count. */
export interface DriverRosterPage extends Paginated<DriverRosterRow> {
  counts: DriverRosterCounts;
}

/** Relation ids by stored company status — the only statuses a roster segment excludes on. */
export interface UnavailableRelationIds {
  notAvailable: string[];
  left: string[];
}

/** "Requests to You" list — status/initiatedBy are fixed by the service, so only paging + search. */
export interface ListJoinRequestsInput extends PaginationInput {
  search?: string;
}

/** Raw `req.query` shape for the list endpoint — normalized into `ListDriversInput` by the service. */
export interface ListDriversQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  status?: string;
  operationalStatus?: string;
}

export interface AddDriverDocumentInput {
  documentType: DriverDocumentType;
  fileUrl: string;
  documentNumber?: string;
  verificationSource?: DriverDocumentVerificationSource;
}

export interface RecordVerificationInput {
  verificationType: DriverVerificationType;
  verificationStatus: DriverVerificationStatus;
  sourceReference?: string;
  holderName?: string;
  licenseNumber?: string;
  validUntil?: string;
  licenseClass?: string;
  licenseStatus?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  rawResponse?: Record<string, unknown>;
}

export interface AddBankDetailsInput {
  accountNumber: string;
  ifsc: string;
  accountHolderName?: string;
  upiId?: string;
}

/* Repository-layer data — shapes written to the database. */

/** Fields on the global driver profile (masters.drivers) — person-level, not tenant-scoped. */
export interface CreateDriverProfileData {
  fullName: string;
  phoneNumber: string;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  dateOfJoining: string | null;
  salaryType: DriverSalaryType | null;
  salaryAmount: string | null;
  // Optional so the driver app's self-registration (which never collects them) can leave them out.
  engagementType?: DriverEngagementType | null;
  bhattaPerDay?: string | null;
  advanceOutstanding?: string | null;
  homeBase?: string | null;
  licenseEndorsements?: DriverLicenseEndorsement[];
  dateOfBirth: string | null;
  bloodGroup: DriverBloodGroup | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pinCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  hasLifeInsurance: DriverInsuranceAnswer;
  hasHealthInsurance: DriverInsuranceAnswer;
  onboardingStep?: DriverOnboardingStep | null;
  registrationSource: DriverRegistrationSource;
  createdBy: string | null;
}

export interface UpdateDriverProfileData {
  fullName?: string;
  phoneNumber?: string;
  licenseNumber?: string | null;
  licenseVerified?: boolean;
  licenseExpiry?: string | null;
  dateOfJoining?: string | null;
  salaryType?: DriverSalaryType | null;
  salaryAmount?: string | null;
  engagementType?: DriverEngagementType | null;
  bhattaPerDay?: string | null;
  advanceOutstanding?: string | null;
  homeBase?: string | null;
  licenseEndorsements?: DriverLicenseEndorsement[];
  dateOfBirth?: string | null;
  bloodGroup?: DriverBloodGroup | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  pinCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  hasLifeInsurance?: DriverInsuranceAnswer;
  hasHealthInsurance?: DriverInsuranceAnswer;
  onboardingStep?: DriverOnboardingStep | null;
  registrationSource?: DriverRegistrationSource;
  updatedBy?: string | null;
}

/** Fields on the tenant-scoped approval-workflow record (masters.driver_tenant_relations) — just
 * the link's own state, not employment data (that's global, on the driver profile). */
export interface CreateDriverTenantRelationData extends Partial<InviteSendColumns> {
  tenantId: string;
  driverId: string;
  status: DriverTenantRelationStatus;
  initiatedBy: DriverTenantRelationInitiator;
  initiatedByUserId: string | null;
  driverRespondedAt: Date | null;
  fleetOwnerRespondedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdBy: string | null;
}

/**
 * Columns stamped on driver_tenant_relations every time an invite is sent or re-sent (see
 * driver-tenant-relation.repository.ts's inviteSendColumns) — the drawer shows the latest send.
 */
export interface InviteSendColumns {
  inviteSentAt: Date;
  inviteExpiresAt: Date;
  inviteSentBy: string | null;
  inviteViewedAt: null;
  inviteViewedDevice: null;
  smsDeliveryStatus: DriverInviteDeliveryStatus;
  smsDeliveryStatusAt: Date;
  whatsappDeliveryStatus: DriverInviteDeliveryStatus;
  whatsappDeliveryStatusAt: Date;
  pushDeliveryStatus: DriverInviteDeliveryStatus;
  pushDeliveryStatusAt: Date;
}

export interface UpdateDriverTenantRelationData {
  status?: DriverTenantRelationStatus;
  driverRespondedAt?: Date | null;
  fleetOwnerRespondedAt?: Date | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  rejectionReason?: string | null;
  updatedBy?: string | null;
}

export interface ListDriversFilters {
  status?: DriverTenantRelationStatus;
  initiatedBy?: DriverTenantRelationInitiator;
  operationalStatus?: DriverOperationalStatus;
  segment?: DriverRosterSegment;
  search?: string;
  page: number;
  limit: number;
}

export interface CreateDriverDocumentData {
  tenantId: string | null;
  driverId: string;
  documentType: DriverDocumentType;
  fileUrl: string;
  documentNumber: string | null;
  verificationSource: DriverDocumentVerificationSource;
  verifiedAt: Date | null;
  createdBy: string | null;
}

export interface CreateDriverVerificationData {
  tenantId: string | null;
  driverId: string;
  verificationType: DriverVerificationType;
  verificationStatus: DriverVerificationStatus;
  sourceReference: string | null;
  holderName: string | null;
  licenseNumber: string | null;
  validUntil: string | null;
  licenseClass: string | null;
  licenseStatus: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pinCode: string | null;
  rawResponse: Record<string, unknown> | null;
  verifiedAt: Date | null;
  createdBy: string | null;
}

export interface CreateDriverBankDetailsData {
  tenantId: string | null;
  driverId: string;
  accountNumber: string;
  ifsc: string;
  accountHolderName: string | null;
  upiId: string | null;
  verificationStatus?: DriverBankVerificationStatus;
  verifiedAt?: Date | null;
  sourceReference?: string | null;
  nameAtBank?: string | null;
  rawResponse?: Record<string, unknown> | null;
  createdBy: string | null;
}

/* Operational status — one current row per driver-tenant relation. */

export interface SetDriverOperationalStatusInput {
  operationalStatus: DriverOperationalStatus;
  reason?: string;
  effectiveAt?: string;
}

export interface CreateDriverOperationalStatusData {
  tenantId: string;
  driverTenantRelationId: string;
  operationalStatus: DriverOperationalStatus;
  reason: string | null;
  effectiveAt: Date;
  createdBy: string | null;
}

export interface UpdateDriverOperationalStatusData {
  operationalStatus?: DriverOperationalStatus;
  reason?: string | null;
  effectiveAt?: Date;
  updatedBy?: string | null;
}

/* Trip metrics — one row per driver-tenant relation per reporting period. */

export interface RecordDriverTripMetricsInput {
  periodStart: string;
  periodEnd: string;
  tripsCount: number;
  onTimePercentage: number;
}

export interface CreateDriverTripMetricsData {
  tenantId: string;
  driverTenantRelationId: string;
  periodStart: string;
  periodEnd: string;
  tripsCount: number;
  onTimePercentage: string;
  createdBy: string | null;
}

export interface UpdateDriverTripMetricsData {
  tripsCount?: number;
  onTimePercentage?: string;
  updatedBy?: string | null;
}

/**
 * The whole "Add a driver" form in one request. Every section past the first is optional, and the
 * service applies them in a single transaction so a failure late on cannot leave a half-built driver.
 *
 * The vehicle link is deliberately not here: it spans the vehicle aggregate and is owned by
 * FleetDriverLinkService, so it stays a separate `POST /vehicles/:vehicleId/drivers` call.
 */
export interface OnboardDriverInput extends Omit<CreateDriverInput, 'onboardingStep'> {
  verification?: RecordVerificationInput;
  bankDetails?: AddBankDetailsInput;
  documents?: AddDriverDocumentInput[];
  operationalStatus?: SetDriverOperationalStatusInput;
}

/* Route parameter shapes, used to type `Request<P>` in the controller. */

export type DriverParams = { driverId: string };
export type InvitationParams = { invitationId: string };
export type DriverDocumentParams = { driverId: string; documentId: string };
export type DriverBankDetailsParams = { driverId: string; bankDetailsId: string };
export type DriverRelationParams = { relationId: string };
