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
  DriverInvitationStatus,
  DriverInviteDeliveryStatus,
  DriverLicenseEndorsement,
  DriverRosterSegment,
} from './drivers.types';
import { PaginationInput } from '../../shared/utils/pagination';

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateDriverInput {
  fullName: string;
  phoneNumber: string;
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
  search?: string;
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
  sentAt: Date;
  expiresAt: Date | null;
  respondedAt: Date | null;
  rejectionReason: string | null;
}

/** Invitation detail drawer — the list row plus credentials, timeline and delivery channels. */
export interface DriverInvitationDetailView extends DriverInvitationView {
  credentials: {
    licenseNumber: string | null;
    licenseClass: string | null;
    /** Latest Sarathi DL check; null when the licence was never checked. */
    registry: {
      source: 'sarathi';
      status: DriverVerificationStatus;
      checkedAt: Date | null;
    } | null;
  };
  timeline: DriverInvitationTimelineStep[];
  deliveryChannels: {
    channel: 'sms' | 'whatsapp' | 'push';
    status: DriverInviteDeliveryStatus | null;
    statusAt: Date | null;
  }[];
}

/**
 * Latest send only: sent → viewed (once the driver opened the invite notification) → one final
 * step derived from the relation's status (accepted / rejected / expired / awaiting_response).
 */
export type DriverInvitationTimelineStep =
  | { step: 'sent'; at: Date; by: { name: string | null; role: string | null } | null }
  | { step: 'viewed'; at: Date; device: string | null }
  | { step: 'accepted'; at: Date | null }
  | { step: 'rejected'; at: Date | null; reason: string | null }
  | { step: 'expired'; at: Date | null }
  | { step: 'awaiting_response'; at: null };

/**
 * Driver detail screen sections — added on top of the flattened driver by GET /drivers/{id} so
 * the whole screen loads in one call. Fields typed `null`/`[]`-only have no backing data yet;
 * their shapes are fixed here so the frontend can build against them before the data exists.
 */
export interface DriverDetailSections {
  licence: {
    number: string | null;
    classOfVehicle: string | null;
    /** Endorsement codes, e.g. ['hazmat']; [] when none. */
    endorsements: DriverLicenseEndorsement[];
    validTo: string | null;
    /** Whole days until licenseExpiry (negative once expired); null when no expiry is on file. */
    daysLeft: number | null;
    registry: DriverInvitationDetailView['credentials']['registry'];
    /** Active link to this tenant, licence verified and not expired. */
    eligibleToDrive: boolean;
  };
  contact: {
    primaryMobile: string;
    bloodGroup: DriverBloodGroup | null;
    emergencyContact: { name: string | null; phone: string; relation: string | null } | null;
    /** On-roll salaried / per trip / vendor's driver — null until set on the driver. */
    engagementType: DriverEngagementType | null;
    dateOfJoining: string | null;
    tenureYears: number | null;
    /** Hand-entered balance of advances not yet recovered; null until set. */
    advanceOutstanding: string | null;
    compensation: {
      salaryType: DriverSalaryType | null;
      salaryAmount: string | null;
      /** Daily bhatta on a trip — null until set on the driver. */
      bhattaPerDay: string | null;
    };
  };
  assignment: {
    vehicle: {
      id: string;
      registrationNumber: string;
      truckType: { id: string; name: string } | null;
    } | null;
    /** Yard/branch the driver operates from; null until set. */
    homeBase: string | null;
  };
  availability: {
    /** Stored company status; can lag reality since load assignment doesn't update it. */
    operationalStatus: DriverOperationalStatus | null;
    /** Live check — the driver's newest non-closed load. */
    activeLoad: { id: string; code: string; status: string } | null;
    dispatchable: boolean;
  };
  performance: {
    totalTrips: number;
    onTimePercentage: number | null;
    /** No scoring model exists yet. */
    driverScore: null;
  };
  /** Future shape: `{ from, to, laneType, distanceKm }[]` — no lane/distance data yet. */
  knownLanes: never[];
  /** Future shape: `{ event: 'over_speeding' | 'harsh_braking' | 'harsh_acceleration' |
   *  'night_driving', per1000Km, fleetComparison }[]` — no telematics events yet. */
  behaviour: null;
  /** Future shape: `{ loadId, code, status, from, to, date, progressPercentage }[]` — no SLA
   *  data yet. */
  slaBreachTrips: never[];
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
export interface OnboardDriverInput extends CreateDriverInput {
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
