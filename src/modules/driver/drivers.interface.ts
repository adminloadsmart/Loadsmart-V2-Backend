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
  DriverNotDispatchableReason,
  DriverJoiningDateSource,
  DriverRosterSegment,
  DriverRosterEmploymentFilter,
  DriverLicenceValidityFilter,
  DriverLicenceClassFilter,
  DriverScoreStatus,
  DriverImportErrorCode,
  DriverListStatusFilter,
  DriverInviteChannel,
  DriverInviteSendStep,
  DriverJoinRequestStatus,
} from './drivers.types';
import { Paginated, PaginationInput } from '../../shared/utils/pagination';
import { DriverEntity } from './entities/driver.entity';
import { SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import {
  DriverInviteEvent,
  DriverTenantRelationEntity,
} from './entities/driver-tenant-relation.entity';

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
  /** This fleet's own note about the driver — stored on the relation, not the shared profile. */
  note?: string;
  // Set by onboardDriver itself (never from the request body) — `completed` once the form carries
  // everything the driver app's registration needs, so the app skips its wizard.
  onboardingStep?: DriverOnboardingStep;
}

export interface UpdateDriverInput {
  fullName?: string;
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
  /** null clears it. */
  note?: string | null;
}

export interface ListDriversInput extends PaginationInput {
  /** Omitted = `active` (the roster) — see DRIVER_LIST_STATUS_FILTERS. */
  status?: DriverListStatusFilter;
  initiatedBy?: DriverTenantRelationInitiator;
  operationalStatus?: DriverOperationalStatus;
  /** "Active Roster" tab — see DRIVER_ROSTER_SEGMENTS. Omitted = no segment narrowing. */
  segment?: DriverRosterSegment;
  search?: string;
  // Roster filter panel — every option ticked within a list is OR'd; the lists themselves AND.
  employmentType?: DriverRosterEmploymentFilter[];
  licenceValidity?: DriverLicenceValidityFilter[];
  licenceClass?: DriverLicenceClassFilter[];
  hazmatEndorsed?: boolean;
  scoreStatus?: DriverScoreStatus[];
  appInstalled?: boolean;
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
  channel: DriverInviteChannel;
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
  /** First tap on the invite WhatsApp's tracked app link since the latest send; null until then
   *  (and always, when API_PUBLIC_URL isn't set). Reset by every Resend, so it describes the
   *  invite currently waiting. */
  openedAt: Date | null;
  /** Whether POST …/resend would go through now — drives the Resend button. */
  canResend: boolean;
  /** Sends left since the driver first declined (DRIVER_INVITE_SENDS_AFTER_DECLINE, then one per
   *  DRIVER_INVITE_COOL_OFF_DAYS); null when they never declined, so no cap applies. */
  sendsLeftAfterDecline: number | null;
  /** While no send is left: when the next one opens up ("You can send it again on 31 Oct").
   *  Null otherwise. */
  canSendAgainAt: Date | null;
}

/** Where an invite stands against the decline cap (see driver.service.ts's sendsAfterDeclineOf). */
export interface DriverInviteSendsAfterDecline {
  /** Sends allowed right now. */
  left: number;
  /** While none is left: when the next send opens up. Null otherwise. */
  sendAgainAt: Date | null;
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

/** Staff user behind a timeline entry, as the drawer shows them. */
export interface DriverInvitationActor {
  name: string | null;
  role: string | null;
}

/** A staff user with their id — who rejected a join request. */
export interface DriverStaffActor extends DriverInvitationActor {
  id: string;
}

/**
 * The invite's whole history in one thread sorted by time (buildInvitationTimeline): every stored
 * DriverInviteEvent with `by` resolved to the staff user, `opened` when the driver read a send's
 * WhatsApp message (once per send), `installed` at the driver's first app login, then, while the
 * invite is still pending, one derived last step: `expired` (at expiresAt) once it has run out,
 * otherwise `awaiting_response`.
 */
export type DriverInvitationTimelineStep =
  | { step: DriverInviteSendStep; at: Date; by: DriverInvitationActor | null }
  | { step: 'opened'; at: Date }
  | { step: 'installed'; at: Date }
  | { step: 'accepted'; at: Date | null }
  | { step: 'declined'; at: Date | null; reason: string | null }
  | { step: 'expired'; at: Date | null }
  | { step: 'cancelled'; at: Date; by: DriverInvitationActor | null }
  | { step: 'delivery_failed'; at: Date; channel: DriverInviteChannel }
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
  /** The transport classes on the licence (DRIVER_TRANSPORT_LICENCE_CLASSES), e.g.
   *  [{ code: 'HTV', label: 'Heavy Transport Vehicle' }]; [] for a non-transport licence or none
   *  on file. */
  transportClasses: DriverLicenceClass[];
  dateOfBirth: string | null;
  /** Whole years from dateOfBirth; null when it isn't on file. */
  age: number | null;
  /** State + RTO code from the licence number, e.g. "HR55"; null when the number doesn't start
   *  with one. The RTO's name isn't available. */
  issuingRtoCode: string | null;
}

export interface DriverLicenceClass {
  code: string;
  /** DRIVER_LICENCE_CLASS_LABELS name; the code itself when unknown. */
  label: string;
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
  /** Staff-entered date of joining, else the date this fleet approved the driver; null if neither. */
  dateOfJoining: string | null;
  /** 'entered' = typed in by staff; 'approved' = fallback to the fleet's approval date. */
  dateOfJoiningSource: DriverJoiningDateSource | null;
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

/** Driver detail → "Availability & dispatch status" card (also a roster row's Availability
 *  column). The full stored row is also on the top-level `operationalStatus`. */
export interface DriverAvailabilitySection {
  /** Live check — the driver's newest non-closed load. */
  activeLoad: DriverActiveLoadSummary | null;
  dispatchable: boolean;
  /** Why not dispatchable ("Already on a load"); null when dispatchable. */
  notDispatchableReason: DriverNotDispatchableReason | null;
  /** The company status buttons' selection; null when never set. */
  companyStatus: DriverOperationalStatus | null;
  /** "Fit to drive again from" (On leave / Medically unfit); null when not set. */
  availableFrom: string | null;
  /** The dispatch note saved with the status; null when none. */
  statusNote: string | null;
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
  /** This fleet's own note about the driver; null when none. */
  note: string | null;
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

/** The phone the driver last used the app on — "Android · …" under "Driver app". */
export interface DriverAppDevice {
  /** 'android' | 'ios', as the app registered it; null when not reported. */
  deviceType: string | null;
  /** Free text the app sends at login (model / OS / app version); null when not sent. */
  deviceInfo: string | null;
}

/** The staff user who last wrote the fleet's note. */
export interface DriverTeamNoteAuthor {
  id: string;
  name: string | null;
}

/** The fleet's own note card — "Note · team only · Mohit, 1 Aug 2020". */
export interface DriverTeamNote {
  text: string;
  /** Null for a note saved before the author was recorded. */
  updatedAt: Date | null;
  updatedBy: DriverTeamNoteAuthor | null;
}

/** Sections only GET /drivers/{id} returns (each needs its own query, so not on roster rows). */
export interface DriverDetailOnlySections {
  /** Null when the driver never logged into the app. */
  appDevice: DriverAppDevice | null;
  /** Null when the fleet has no note on the driver. */
  teamNote: DriverTeamNote | null;
}

/** GET /drivers/{id} — the flattened driver plus every section of the driver detail screen. */
export type DriverDetailView = DriverWithRelation & DriverDetailSections & DriverDetailOnlySections;

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

/** "Requests to You" list — paging + search, and which list: pending (default) or rejected. */
export interface ListJoinRequestsInput extends PaginationInput {
  search?: string;
  status?: DriverJoinRequestStatus;
}

/** PATCH /drivers/:driverId/reject body. */
export interface RejectDriverInput {
  reason: string | null;
  /** Send the driver the "request declined" notification — only for their own join request.
   *  Omitted = true, as before this flag existed. */
  notifyDriver: boolean;
}

/** One row of Recently Rejected — the pending list's item plus who rejected it and until when it
 *  can be restored. */
export interface DriverRejectedJoinRequestView extends DriverWithRelation {
  rejectedAt: Date;
  rejectedBy: DriverStaffActor | null;
  restorableUntil: Date;
  /** Whether PATCH …/restore would go through for this caller now — drives the Restore button. */
  canRestore: boolean;
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
  note?: string | null;
  noteUpdatedBy?: string | null;
  noteUpdatedAt?: Date | null;
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
  note?: string | null;
  noteUpdatedBy?: string | null;
  noteUpdatedAt?: Date | null;
  updatedBy?: string | null;
}

/** The roster query's filters without paging — shared by the paged list and the export. */
export type RosterQueryFilters = Omit<ListDriversFilters, 'page' | 'limit'>;

/** GET /drivers/export — the roster's filters minus paging; status is always the roster. */
export type ExportDriversFilters = Omit<RosterQueryFilters, 'status' | 'initiatedBy'>;

/** One column of the roster export: the cell key driverToExportRow fills, and its header. */
export interface DriverExportColumn {
  key: DriverExportColumnKey;
  header: string;
}

export type DriverExportColumnKey =
  | 'fullName'
  | 'mobileNumber'
  | 'dateOfBirth'
  | 'address'
  | 'city'
  | 'pinCode'
  | 'licenceNumber'
  | 'licenceClass'
  | 'licenceEndorsements'
  | 'licenceValidTo'
  | 'licenceDaysLeft'
  | 'sarathiVerification'
  | 'sarathiCheckedOn'
  | 'eligibleToDrive'
  | 'bloodGroup'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'emergencyContactRelation'
  | 'engagementType'
  | 'dateOfJoining'
  | 'tenureYears'
  | 'payType'
  | 'payAmount'
  | 'bhattaPerDay'
  | 'advanceOutstanding'
  | 'assignedVehicle'
  | 'truckType'
  | 'homeBase'
  | 'availability'
  | 'availabilityReason'
  | 'currentLoad'
  | 'trips'
  | 'onTimePercentage'
  | 'driverScore'
  | 'driverAppInstalled'
  | 'appLastSeen'
  | 'note';

export interface ListDriversFilters {
  status?: DriverListStatusFilter;
  initiatedBy?: DriverTenantRelationInitiator;
  operationalStatus?: DriverOperationalStatus;
  segment?: DriverRosterSegment;
  search?: string;
  // Roster filter panel — every option ticked within a list is OR'd; the lists themselves AND.
  employmentType?: DriverRosterEmploymentFilter[];
  licenceValidity?: DriverLicenceValidityFilter[];
  licenceClass?: DriverLicenceClassFilter[];
  hazmatEndorsed?: boolean;
  scoreStatus?: DriverScoreStatus[];
  appInstalled?: boolean;
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
  /** YYYY-MM-DD; only with DRIVER_RETURNING_OPERATIONAL_STATUSES. */
  availableFrom?: string;
}

export interface CreateDriverOperationalStatusData {
  tenantId: string;
  driverTenantRelationId: string;
  operationalStatus: DriverOperationalStatus;
  reason: string | null;
  effectiveAt: Date;
  availableFrom: string | null;
  createdBy: string | null;
}

export interface UpdateDriverOperationalStatusData {
  operationalStatus?: DriverOperationalStatus;
  reason?: string | null;
  effectiveAt?: Date;
  availableFrom?: string | null;
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

/** GET /driver-invites/open/:token — the invite WhatsApp's tracked app link. */
export type InviteLinkParams = { token: string };
export type DriverDocumentParams = { driverId: string; documentId: string };
export type DriverBankDetailsParams = { driverId: string; bankDetailsId: string };
export type DriverRelationParams = { relationId: string };

/* Bulk driver upload (driver-import.mapper.ts / driver-import.service.ts). */

/** One column of the bulk-upload sheet. */
export interface DriverImportColumn {
  key: string;
  /** Other headers accepted for this column — matched case/space/punctuation-insensitively. */
  aliases?: string[];
}

export interface ParsedDriverRow {
  row: number;
  input: Record<string, unknown>;
}

export interface ParsedDriverExcel {
  rows: ParsedDriverRow[];
  mapping: Record<string, string>;
}

export interface DriverImportRowError {
  row: number;
  /** The mobile number as typed in the sheet, so the row is identifiable without counting lines. */
  phoneNumber?: string;
  /** Sheet column header the problem is in, when it maps to one. */
  column?: string;
  field?: string;
  code: DriverImportErrorCode;
  message: string;
}

/** The parts of the Sarathi result the preview screen shows next to the typed-in row. */
export interface DriverImportLicenceCheck {
  status: SarathiDrivingLicenceResult['status'];
  holderName?: string;
  validUntil?: string;
  licenseClass?: string;
  transportClass?: string;
  licenseStatus?: string;
  age?: number;
}

export interface DriverImportPreviewRow {
  row: number;
  /**
   * `ready` — can be saved as-is. `needs_review` — saveable, but Sarathi could not confirm the
   * licence, so it is recorded for manual review. `invalid` — fix the sheet; `data` is absent.
   */
  status: 'ready' | 'needs_review' | 'invalid';
  /** Exactly what to send back in POST /drivers/import once the admin approves the row. */
  data?: OnboardDriverInput;
  licenceCheck?: DriverImportLicenceCheck;
  /** Saveable, but worth a look before approving (e.g. the sheet name differs from Sarathi's). */
  warnings: string[];
  errors: DriverImportRowError[];
}

export interface DriverImportPreview {
  totalRows: number;
  readyRows: number;
  needsReviewRows: number;
  invalidRows: number;
  columnMapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
}

export interface DriverImportResult {
  /** Position in the submitted `drivers` array. */
  index: number;
  phoneNumber: string;
  status: 'created' | 'failed';
  driverId?: string;
  code?: DriverImportErrorCode;
  message?: string;
}

export interface DriverImportReport {
  total: number;
  created: number;
  failed: number;
  results: DriverImportResult[];
}

/** How one code is sent: its HTTP status, and the message shown to the user as-is (Title Case to
 *  match the UI). */
export interface DriverErrorDefinition {
  statusCode: 404 | 409;
  message: string;
}

/** ILIKE patterns for the roster search box (driver-tenant-relation.repository.ts) — `phone` is
 *  null when the term has no digits. */
export interface DriverSearchPatterns {
  name: string;
  phone: string | null;
  license: string;
}

/** One page of a tenant's driver relations and the total across pages. */
export type DriverRelationPage = Pick<Paginated<DriverTenantRelationEntity>, 'items' | 'total'>;

/** What the invitation drawer's timeline is built from (invitation-timeline.ts). */
export interface InvitationTimelineInput {
  events: readonly DriverInviteEvent[];
  toActor: (userId: string | null) => DriverInvitationActor | null;
  firstAppLoginAt: Date | null;
  status: DriverInvitationStatus;
  expiresAt: Date | null;
}

/** A driver's trip count and on-time share, for the detail page's performance section. */
export interface DriverTripStats {
  total: number;
  onTimePercentage: number | null;
}

/** The daily DRIVER_AVAILABILITY_RETURN_JOB's result. */
export interface DriverAvailabilityReturnResult {
  returnedToAvailable: number;
}
