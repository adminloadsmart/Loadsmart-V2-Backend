import { DataSource, EntityManager, In } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import {
  DriverInviteEvent,
  DriverTenantRelationEntity,
} from './entities/driver-tenant-relation.entity';
import { LoadEntity } from '../loads/entities/load.entity';
import {
  DRIVER_TRANSPORT_LICENCE_CLASSES,
  DriverBankVerificationStatus,
  DriverInviteWhatsAppReportStatus,
  DriverNotDispatchableReason,
  DriverOperationalStatus,
  DriverScoreStatus,
} from './drivers.types';
import { DriverRepository } from './driver.repository';
import {
  DriverTenantRelationRepository,
  inviteSendColumns,
  isInviteSendEvent,
} from './driver-tenant-relation.repository';
import { buildInvitationTimeline } from './invitation-timeline';
import { Paginated, paginate } from '../../shared/utils/pagination';
import { humanizeStatus } from '../../shared/utils/humanize';
import { DlVerificationClient, SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { StorageService } from '../storage/storage.service';
import { OrganizationService } from '../organization/organization.service';
import { MasterApprovalNotifier } from '../notifications/notifications.interface';
import { DriverPushNotifier } from './auth/driver-push-notifier';
import { DriverAnalyticsRepository } from '../analytics/driver-analytics/driver-analytics.repository';
import { DriverSessionRepository } from './auth/driver-auth.repository';
import {
  DRIVER_EXPORT_MAX_ROWS,
  DRIVER_INVITE_COOL_OFF_DAYS,
  DRIVER_INVITE_SENDS_AFTER_DECLINE,
  DRIVER_JOIN_REQUEST_RESTORE_DAYS,
  DRIVER_LICENCE_CLASS_LABELS,
  MIN_SCORED_TRIPS,
} from './driver.constants';
import { formatDate } from '../../shared/i18n/format';
import { toIstDateString } from '../../shared/utils/ist-time';
import { DEFAULT_LOCALE } from '../../shared/i18n/locales';
import { buildDriverWorkbook } from './driver-export.mapper';
import { DriverError } from './driver.errors';
import { getCachedLicenceLookup, setCachedLicenceLookup } from './driver-licence-lookup-cache';
import {
  BankAccountVerificationResult,
  IdfyClient,
  toBankVerificationColumns,
} from '../../adapters/idfy.client';
import {
  DriverLicenceClass,
  AddBankDetailsInput,
  AddDriverDocumentInput,
  CreateDriverInput,
  DriverDetailSections,
  DriverDetailView,
  DriverRegistryCheck,
  DriverRosterPage,
  DriverRosterRow,
  DriverWithRelation,
  ListDriversInput,
  ListJoinRequestsInput,
  ListInvitationsInput,
  DriverInvitationView,
  DriverInvitationDetailView,
  DriverInviteSendsAfterDecline,
  DriverInvitationActor,
  DriverRejectedJoinRequestView,
  ExportDriversFilters,
  RejectDriverInput,
  OnboardDriverInput,
  RecordDriverTripMetricsInput,
  RecordVerificationInput,
  SetDriverOperationalStatusInput,
  UpdateDriverInput,
  CreateDriverTenantRelationData,
  DriverAvailabilityReturnResult,
  DriverTripStats,
  InviteDriverByPhoneInput,
  InviteDriverByPhoneResult,
} from './drivers.interface';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;

// Picks only the relation-specific fields, named explicitly — never a blind `...relation` spread.
// DriverTenantRelationEntity carries its own `id`/`createdBy`/`updatedBy`/`deletedAt`/`createdAt`/
// `updatedAt` audit columns (every TypeORM entity does), which would silently clobber the driver's
// own `id` etc. if spread after `...driver`. `id` must stay the driver's global id — the same
// value that's always been in the :driverId URL param — never the relation's own row id.
function latestLicenseClass(verifications: DriverVerificationEntity[] | undefined): string | null {
  const latest = (verifications ?? [])
    .filter((verification) => verification.licenseClass)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.licenseClass ?? null;
}

function latestSarathiCheck(
  verifications: DriverVerificationEntity[] | undefined,
): DriverRegistryCheck | null {
  const latest = (verifications ?? [])
    .filter((verification) => verification.verificationType === 'sarathi_dl')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest
    ? {
        source: 'sarathi',
        status: latest.verificationStatus,
        checkedAt: latest.verifiedAt ?? latest.createdAt,
      }
    : null;
}

/** Shapes a Sarathi lookup into the `sarathi_dl` verification row onboardDriver records. */
function toLicenceVerificationInput(
  result: SarathiDrivingLicenceResult,
  licenseNumber: string,
): RecordVerificationInput {
  return {
    verificationType: 'sarathi_dl',
    verificationStatus: result.status,
    holderName: result.holderName,
    licenseNumber,
    validUntil: result.validUntil,
    licenseClass: result.licenseClass,
    licenseStatus: result.licenseStatus,
    addressLine1: result.addressLine1,
    addressLine2: result.addressLine2,
    city: result.city,
    pinCode: result.pinCode,
    rawResponse: result.rawResponse,
  };
}

/**
 * Whether the driver can no longer act on anything — today only "deleted their own account"
 * (DriverAccountService.deleteAccount). The single place to extend if a platform block/suspend
 * flag is added; keep DriverTenantRelationRepository.listInvitations' SQL in step with it.
 */
export function isDriverOffPlatform(driver: Pick<DriverEntity, 'deletedAt'>): boolean {
  return driver.deletedAt !== null;
}

// Only ever called on rows listInvitations/resendInvite returned — tenant-initiated, invite sent —
// so anything that isn't pending/active is a driver decline. A still-pending invite to a driver
// who has left the platform reads `expired` — nobody is left to accept it.
/**
 * Sends still allowed since the driver first declined, counted from the invite's timeline:
 * DRIVER_INVITE_SENDS_AFTER_DECLINE, then — once those are used — one more each time
 * DRIVER_INVITE_COOL_OFF_DAYS pass after the latest decline or send, whichever is later.
 * `sendAgainAt` is when that next send opens up, while none is left (null otherwise). Null when
 * they never declined, so no cap applies.
 */
function sendsAfterDeclineOf(
  relation: DriverTenantRelationEntity,
): DriverInviteSendsAfterDecline | null {
  const timeline = relation.inviteTimeline;
  const firstDecline = timeline.findIndex((event) => event.step === 'declined');
  if (firstDecline === -1) return null;
  const sinceDecline = timeline.slice(firstDecline);
  const sendsSince = sinceDecline.filter(isInviteSendEvent).length;
  const left = DRIVER_INVITE_SENDS_AFTER_DECLINE - sendsSince;
  if (left > 0) return { left, sendAgainAt: null };

  const lastDeclineOrSendAt = Math.max(
    ...sinceDecline
      .filter((event) => event.step === 'declined' || isInviteSendEvent(event))
      .map((event) => Date.parse(event.at)),
  );
  const sendAgainAt = new Date(lastDeclineOrSendAt + DRIVER_INVITE_COOL_OFF_DAYS * MS_PER_DAY);
  return sendAgainAt <= new Date() ? { left: 1, sendAgainAt: null } : { left: 0, sendAgainAt };
}

/** Shared by Resend and invite-by-mobile, so neither route gets around the cap. */
function assertSendAllowedAfterDecline(relation: DriverTenantRelationEntity): void {
  const sendsAfterDecline = sendsAfterDeclineOf(relation);
  if (sendsAfterDecline?.sendAgainAt) {
    throw new ConflictError(
      `This driver declined your invitation and it has already been sent again — you can send it once more from ${formatDate(sendsAfterDecline.sendAgainAt, DEFAULT_LOCALE)}`,
    );
  }
}

function toInvitationView(
  relation: DriverTenantRelationEntity,
  appInstalled: boolean,
): DriverInvitationView {
  let status: DriverInvitationView['status'];
  let expiredReason: DriverInvitationView['expiredReason'] = null;
  if (relation.status === 'active') status = 'accepted';
  else if (relation.status === 'rejected') status = 'rejected';
  else if (relation.status === 'cancelled') status = 'cancelled';
  else if (isDriverOffPlatform(relation.driver)) {
    status = 'expired';
    expiredReason = 'driver_inactive';
  } else if (relation.inviteExpiresAt && relation.inviteExpiresAt <= new Date()) {
    status = 'expired';
    expiredReason = 'invite_timeout';
  } else status = 'pending';

  const sendsAfterDecline = sendsAfterDeclineOf(relation);
  // Same rules as assertCanResend, so the Resend button and the endpoint never disagree.
  const resendable =
    status === 'pending' ||
    status === 'rejected' ||
    (status === 'expired' && expiredReason === 'invite_timeout');

  return {
    invitationId: relation.id,
    requestId: formatInviteRequestId(relation.inviteNumber),
    driverId: relation.driverId,
    fullName: relation.driver.fullName,
    phoneNumber: relation.driver.phoneNumber,
    status,
    expiredReason,
    sentAt: relation.inviteSentAt!,
    expiresAt: relation.inviteExpiresAt,
    respondedAt: relation.driverRespondedAt,
    rejectionReason: relation.rejectionReason,
    deliveryChannels: [
      {
        channel: 'sms',
        status: relation.smsDeliveryStatus,
        statusAt: relation.smsDeliveryStatusAt,
      },
      {
        channel: 'whatsapp',
        status: relation.whatsappDeliveryStatus,
        statusAt: relation.whatsappDeliveryStatusAt,
      },
      {
        channel: 'push',
        status: relation.pushDeliveryStatus,
        statusAt: relation.pushDeliveryStatusAt,
      },
    ],
    appInstalled,
    openedAt: relation.inviteViewedAt,
    canResend: resendable && sendsAfterDecline?.left !== 0,
    sendsLeftAfterDecline: sendsAfterDecline?.left ?? null,
    canSendAgainAt: sendsAfterDecline?.sendAgainAt ?? null,
  };
}

/**
 * Who a new tenant–driver link starts with, by the adding role: org_admin's driver is invited
 * right away (`pending_driver_review`, invite stamped); dispatch's (the only other role the canWrite
 * gate admits) waits at `pending_staff_review` until an org_admin approves it via approveDriver,
 * which is what sends the invite. Shared by onboarding and invite-by-mobile.
 */
function newRelationColumns(
  actorId: string,
  actorRole: string,
): Omit<CreateDriverTenantRelationData, 'tenantId' | 'driverId' | 'createdBy'> {
  const isAdmin = actorRole === ORG_ADMIN_ROLE;
  const now = new Date();
  return {
    status: isAdmin ? 'pending_driver_review' : 'pending_staff_review',
    initiatedBy: isAdmin ? 'fleet_owner' : 'staff',
    initiatedByUserId: actorId,
    driverRespondedAt: null,
    fleetOwnerRespondedAt: now,
    approvedBy: null,
    approvedAt: null,
    ...(isAdmin && inviteSendColumns(actorId, now)),
  };
}

/** Whether this tenant's latest row for a driver allows inviting them again by mobile number. */
function assertCanReinvite(relation: DriverTenantRelationEntity): void {
  switch (relation.status) {
    case 'active':
      throw new ConflictError('This driver is already in your fleet');
    case 'pending_staff_review':
      throw new ConflictError('This driver is already awaiting approval in your organisation');
    case 'pending_driver_review':
      if (relation.inviteExpiresAt && relation.inviteExpiresAt > new Date()) {
        throw new ConflictError('An invite to this number is already pending — use Resend');
      }
      break; // expired — invite again
    case 'rejected':
    case 'cancelled':
      break;
  }
  assertSendAllowedAfterDecline(relation);
}

/** Whether Resend applies to this invitation — the message is shown to the user as-is. */
function assertCanResend(invite: DriverTenantRelationEntity & { driver: DriverEntity }): void {
  switch (invite.status) {
    case 'active':
      throw new ConflictError('This driver has already accepted the invitation');
    case 'cancelled':
      throw new ConflictError(
        'This invitation was cancelled and cannot be resent — invite the mobile number again',
      );
    case 'pending_staff_review':
      throw new ConflictError('This invitation is waiting for approval in your organisation');
    case 'rejected':
      // Only a driver's decline is resendable — a staff rejection never reached the driver.
      if (invite.driverRespondedAt === null) {
        throw new ConflictError('This driver was rejected by your organisation');
      }
      break;
    case 'pending_driver_review':
      break;
  }
  if (isDriverOffPlatform(invite.driver)) {
    throw new ConflictError('This driver is no longer active on the platform');
  }
  assertSendAllowedAfterDecline(invite);
}

/** Fleet-operational writes (availability, trip metrics) need a driver who has actually joined —
 *  same rule as linking to a vehicle (fleet-driver-link.service.ts). */
function assertRelationActive(relation: DriverTenantRelationEntity, action: string): void {
  if (relation.status !== 'active') {
    throw new ValidationError(
      `Driver is ${humanizeStatus(relation.status)} for this tenant and ${action}`,
    );
  }
}

/** Sequential invite number → the drawer's "Req ID", e.g. 42 → INV-00042. */
function formatInviteRequestId(inviteNumber: string): string {
  return `INV-${inviteNumber.padStart(5, '0')}`;
}

function toInvitationDetailView(
  relation: DriverTenantRelationEntity,
  actorsById: Map<string, UserEntity>,
  firstAppLoginAt: Date | null,
): DriverInvitationDetailView {
  const view = toInvitationView(relation, firstAppLoginAt !== null);
  const { driver } = relation;
  const toInvitationActor = (userId: string | null): DriverInvitationActor | null => {
    const actor = userId ? actorsById.get(userId) : undefined;
    return actor ? { name: actor.fullName, role: actor.role?.name ?? null } : null;
  };

  // The stored log as-is (it's append-only), oldest first. Every invite has at least its first
  // send there; the fallback only covers a row the log has somehow never seen.
  const events: DriverInviteEvent[] = relation.inviteTimeline.length
    ? relation.inviteTimeline
    : [{ step: 'sent', at: view.sentAt.toISOString(), by: relation.inviteSentBy }];
  const timeline = buildInvitationTimeline({
    events,
    toActor: toInvitationActor,
    firstAppLoginAt,
    status: view.status,
    expiresAt: relation.inviteExpiresAt,
  });

  return {
    ...view,
    credentials: {
      licenseNumber: driver.licenseNumber,
      licenseClass: latestLicenseClass(driver.verifications),
      registry: latestSarathiCheck(driver.verifications),
    },
    timeline,
  };
}

/** A list row (roster, join requests) — the flattened driver without the raw verification rows,
 *  which are loaded only to derive licenseClass and carry IDfy's rawResponse. */
function toListedDriver(relation: DriverTenantRelationEntity): DriverWithRelation {
  const { verifications: _verifications, ...driver } = flattenRelation(relation);
  return driver as DriverWithRelation;
}

/** Last moment a join request rejected at `rejectedAt` can be restored. */
function joinRequestRestorableUntil(rejectedAt: Date): Date {
  return new Date(rejectedAt.getTime() + DRIVER_JOIN_REQUEST_RESTORE_DAYS * MS_PER_DAY);
}

export function flattenRelation(relation: DriverTenantRelationEntity): DriverWithRelation {
  const { driver } = relation;
  return {
    ...driver,
    driverTenantRelationId: relation.id,
    tenantId: relation.tenantId,
    status: relation.status,
    initiatedBy: relation.initiatedBy,
    approvedBy: relation.approvedBy,
    approvedAt: relation.approvedAt,
    rejectionReason: relation.rejectionReason,
    note: relation.note,
    requestedAt: relation.createdAt,
    licenseClass: latestLicenseClass(driver.verifications),
    operationalStatus: relation.operationalStatus,
    tripMetrics: relation.tripMetrics,
    vehicleLinks: relation.vehicleLinks,
  } as DriverWithRelation;
}

/** Whole days from today (UTC) until a `YYYY-MM-DD` date; negative once it's passed. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.round((new Date(`${date}T00:00:00.000Z`).getTime() - today.getTime()) / MS_PER_DAY);
}

/** Whole years from a `YYYY-MM-DD` date of birth to today (UTC); null when not on file. */
function ageFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const today = new Date().toISOString().slice(0, 10);
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** The transport classes in a class-of-vehicle list ("LMV, HTV" → [HTV · Heavy Transport …]). */
function transportClassesOf(licenseClass: string | null): DriverLicenceClass[] {
  if (!licenseClass) return [];
  const codes = licenseClass.toUpperCase().split(/[^A-Z0-9]+/);
  return [...new Set(codes)]
    .filter((code) => DRIVER_TRANSPORT_LICENCE_CLASSES.includes(code))
    .map((code) => ({ code, label: DRIVER_LICENCE_CLASS_LABELS[code] ?? code }));
}

/** State + RTO code a DL number starts with ("HR5520142079641" → "HR55"). */
function issuingRtoCodeOf(licenseNumber: string | null): string | null {
  const match = licenseNumber?.toUpperCase().match(/^([A-Z]{2})[\s-]?(\d{2})/);
  return match ? `${match[1]}${match[2]}` : null;
}

/** Same checks as `dispatchable`, as the reason the card shows ("Already on a load"). */
function notDispatchableReasonOf(
  isActive: boolean,
  activeLoad: LoadEntity | null,
  operationalStatus: DriverOperationalStatus | null,
): DriverNotDispatchableReason | null {
  if (!isActive) return 'not_active';
  if (activeLoad) return 'on_load';
  if (operationalStatus === 'on_leave') return 'on_leave';
  if (operationalStatus === 'medically_unfit') return 'medically_unfit';
  if (operationalStatus === 'inactive') return 'no_longer_with_us';
  return null;
}

/** Badge for the score column — neutral `new` until there are enough trips and a real score. */
function toScoreStatus(totalTrips: number, driverScore: number | null): DriverScoreStatus {
  if (driverScore === null || totalTrips < MIN_SCORED_TRIPS) return 'new';
  return driverScore >= 80 ? 'strong' : 'watch';
}

function toDriverDetailSections(
  relation: DriverTenantRelationEntity,
  tripStats: DriverTripStats,
  activeLoad: LoadEntity | null,
  appLastSeenAt: Date | null,
): DriverDetailSections {
  const { driver } = relation;
  const daysLeft = daysUntil(driver.licenseExpiry);
  const operationalStatus = relation.operationalStatus?.operationalStatus ?? null;
  const primaryLink = (relation.vehicleLinks ?? []).find(
    (link) => link.isPrimary && link.status === 'active' && !link.deletedAt,
  );
  const isActive = relation.status === 'active';
  const licenseClass = latestLicenseClass(driver.verifications);
  const notDispatchableReason = notDispatchableReasonOf(isActive, activeLoad, operationalStatus);
  // Staff-entered date first; otherwise the day this fleet approved the driver (India date) — app
  // sign-ups never enter one.
  const dateOfJoining =
    driver.dateOfJoining ?? (relation.approvedAt ? toIstDateString(relation.approvedAt) : null);

  return {
    licence: {
      number: driver.licenseNumber,
      classOfVehicle: licenseClass,
      endorsements: driver.licenseEndorsements ?? [],
      validTo: driver.licenseExpiry,
      daysLeft,
      registry: latestSarathiCheck(driver.verifications),
      eligibleToDrive: isActive && driver.licenseVerified && daysLeft !== null && daysLeft > 0,
      transportClasses: transportClassesOf(licenseClass),
      dateOfBirth: driver.dateOfBirth,
      age: ageFromDateOfBirth(driver.dateOfBirth),
      issuingRtoCode: issuingRtoCodeOf(driver.licenseNumber),
    },
    contact: {
      primaryMobile: driver.phoneNumber,
      bloodGroup: driver.bloodGroup,
      emergencyContact: driver.emergencyContactPhone
        ? {
            name: driver.emergencyContactName,
            phone: driver.emergencyContactPhone,
            relation: driver.emergencyContactRelation,
          }
        : null,
      engagementType: driver.engagementType,
      dateOfJoining,
      dateOfJoiningSource: driver.dateOfJoining ? 'entered' : dateOfJoining ? 'approved' : null,
      tenureYears: dateOfJoining
        ? Math.floor((Date.now() - new Date(dateOfJoining).getTime()) / MS_PER_YEAR)
        : null,
      advanceOutstanding: driver.advanceOutstanding,
      compensation: {
        salaryType: driver.salaryType,
        salaryAmount: driver.salaryAmount,
        bhattaPerDay: driver.bhattaPerDay,
      },
    },
    assignment: {
      vehicle: primaryLink
        ? {
            id: primaryLink.vehicle.id,
            registrationNumber: primaryLink.vehicle.registrationNumber,
            truckType: primaryLink.vehicle.truckType
              ? { id: primaryLink.vehicle.truckType.id, name: primaryLink.vehicle.truckType.name }
              : null,
          }
        : null,
      homeBase: driver.homeBase,
    },
    availability: {
      activeLoad: activeLoad
        ? { id: activeLoad.id, code: activeLoad.code, status: activeLoad.status }
        : null,
      dispatchable: notDispatchableReason === null,
      notDispatchableReason,
      companyStatus: operationalStatus,
      availableFrom: relation.operationalStatus?.availableFrom ?? null,
      statusNote: relation.operationalStatus?.reason ?? null,
    },
    performance: {
      totalTrips: tripStats.total,
      onTimePercentage: tripStats.onTimePercentage,
      driverScore: null,
      scoreStatus: toScoreStatus(tripStats.total, null),
    },
    appInstalled: appLastSeenAt !== null,
    appLastSeenAt,
    knownLanes: [],
    behaviour: null,
    slaBreachTrips: [],
  };
}

export class DriverService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly dataSource: DataSource,
    private readonly dlVerificationClient: DlVerificationClient,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly organizationService: OrganizationService,
    private readonly driverPushNotifier: DriverPushNotifier,
    private readonly idfyClient: IdfyClient,
    private readonly driverAnalyticsRepository: DriverAnalyticsRepository,
    private readonly driverSessionRepository: DriverSessionRepository,
    // LS_N_0009/0010 — optional; only queues a notification after the existing logic and never
    // throws (see notifications/master-approvals.ts).
    private readonly approvalNotifier?: MasterApprovalNotifier,
  ) {}

  /**
   * Driving-licence front/back photos (manual Sarathi-review route) are uploaded to S3 through the
   * storage module first — see storage.constants.ts's `masters/driver` purpose. `document.fileUrl`
   * here is that upload's storage `key`, not an arbitrary external URL; this rejects anything that
   * isn't a confirmed, correctly-scoped `masters/driver` upload before it's attached to the driver.
   */
  private async assertDriverDlUpload(
    tenantId: string,
    actorRole: string,
    key: string,
  ): Promise<void> {
    try {
      const { file } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
      if (file.purpose !== 'masters/driver') {
        throw new ValidationError(`File ${key} was not uploaded for a driver document`);
      }
      if (file.status !== 'confirmed') {
        throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
      }
    } catch (error) {
      rethrow(error, 'Failed to verify uploaded driver document');
    }
  }

  /** Resolves a document's stored S3 key into a fresh, short-lived download URL for the response. */
  private async withDocumentDownloadUrl(
    tenantId: string,
    actorRole: string,
    document: DriverDocumentEntity,
  ): Promise<DriverDocumentEntity> {
    const { downloadUrl } = await this.storageService.getByKey(
      { tenantId, role: actorRole },
      document.fileUrl,
    );
    return downloadUrl ? { ...document, fileUrl: downloadUrl } : document;
  }

  /**
   * Preflight check used by the "Verify the driving licence" step of the Add-a-driver form,
   * before the driver record exists — so this never touches `driverRepository`. The caller (the
   * onboarding form) decides what to do with the result: bundle it into `onboardDriver.verification`
   * on `verified`, or switch to the manual-entry fields (photo uploads + typed-in details) and submit
   * that instead on `manual_review`.
   */
  async checkDrivingLicence(
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    try {
      return await this.dlVerificationClient.lookupDrivingLicence(licenseNumber, dateOfBirth);
    } catch (error) {
      rethrow(error, 'Failed to check driving licence against Sarathi');
    }
  }

  /**
   * checkDrivingLicence for the bulk-import preview. A genuine registry answer (one carrying
   * `rawResponse`) is cached so onboardDriver can reuse it when the admin saves the approved rows;
   * the "IDfy unusable" fallback is not, so the save retries a real lookup.
   */
  async checkDrivingLicenceForImport(
    tenantId: string,
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    const result = await this.checkDrivingLicence(licenseNumber, dateOfBirth);
    if (result.rawResponse)
      await setCachedLicenceLookup(tenantId, licenseNumber, dateOfBirth, result);
    return result;
  }

  /**
   * Bank-account preflight, the bank counterpart of checkDrivingLicence: checks an account +
   * IFSC against IDfy before the bank details exist. Submits an async IDfy task and polls for the
   * result before responding. Read-only — every save path (addBankDetails, onboardDriver,
   * DriverIdentityService.completeRegistration) re-runs this same check server-side and persists
   * that result, so nothing the client sends can mark an account verified.
   */
  async checkBankAccount(
    accountNumber: string,
    ifsc: string,
  ): Promise<BankAccountVerificationResult> {
    try {
      return await this.idfyClient.verifyBankAccount(accountNumber, ifsc.toUpperCase());
    } catch (error) {
      rethrow(error, 'Failed to check bank account');
    }
  }

  /** Runs the IDfy check and shapes it into driver_bank_details columns. */
  private async verifyBankAccountFields(accountNumber: string, ifsc: string) {
    return toBankVerificationColumns(await this.idfyClient.verifyBankAccount(accountNumber, ifsc));
  }

  /**
   * Finds the global driver profile by phone, or creates a new one. The profile is person-level —
   * shared across every tenant this phone ever links to — so an existing profile is reused as-is
   * (its own fields are not overwritten by a second tenant's onboarding form).
   */
  private async findOrCreateDriverProfile(
    actorId: string,
    input: CreateDriverInput,
    manager: EntityManager,
  ): Promise<DriverEntity> {
    const existingByPhone = await this.driverRepository.findByPhoneNumber(input.phoneNumber);
    if (existingByPhone) return existingByPhone;

    if (input.licenseNumber) {
      const licenseOwner = await this.driverRepository.findByLicenseNumber(
        input.licenseNumber.toUpperCase(),
      );
      if (licenseOwner) {
        throw new ConflictError('A driver with this license number already exists');
      }
    }

    // Only a brand-new profile needs a name — a reused one keeps its own.
    if (!input.fullName) {
      throw new ValidationError(
        'fullName is required — the licence lookup did not return the holder name',
      );
    }

    return await this.driverRepository.create(
      {
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        licenseNumber: input.licenseNumber?.toUpperCase() ?? null,
        licenseExpiry: input.licenseExpiry ?? null,
        dateOfJoining: input.dateOfJoining ?? null,
        salaryType: input.salaryType ?? null,
        salaryAmount: input.salaryAmount === undefined ? null : String(input.salaryAmount),
        engagementType: input.engagementType ?? null,
        bhattaPerDay: input.bhattaPerDay === undefined ? null : String(input.bhattaPerDay),
        advanceOutstanding:
          input.advanceOutstanding === undefined ? null : String(input.advanceOutstanding),
        homeBase: input.homeBase ?? null,
        licenseEndorsements: input.licenseEndorsements ?? [],
        dateOfBirth: input.dateOfBirth ?? null,
        bloodGroup: input.bloodGroup ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        pinCode: input.pinCode ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        emergencyContactRelation: input.emergencyContactRelation ?? null,
        // Same defaults as the driver app's own registration when the answer is left out.
        hasLifeInsurance: input.hasLifeInsurance ?? 'no',
        hasHealthInsurance: input.hasHealthInsurance ?? 'no',
        onboardingStep: input.onboardingStep ?? null,
        registrationSource: 'staff_created',
        createdBy: actorId,
      },
      manager,
    );
  }

  /**
   * Only called internally, by onboardDriver — there is no standalone create-driver route.
   * org_admin's driver goes straight to the driver as a join request (`pending_driver_review`);
   * dispatch's (the only other role the canWrite gate admits) lands `pending_staff_review` until an
   * org_admin approves it via approveDriver, which is what sends the request to the driver.
   * Neither path makes the driver `active` — only the driver's own accept does.
   */
  private async createDriver(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: CreateDriverInput,
    manager?: EntityManager,
  ): Promise<{ driver: DriverEntity; relation: DriverTenantRelationEntity }> {
    try {
      const run = async (txManager: EntityManager) => {
        const driver = await this.findOrCreateDriverProfile(actorId, input, txManager);

        const existingRelation = await this.driverTenantRelationRepository.findByTenantAndDriver(
          tenantId,
          driver.id,
          txManager,
        );
        if (existingRelation) {
          throw new ConflictError('A driver with this phone number already exists');
        }

        // org_admin's driver is invited right away; dispatch's only once approveDriver runs.
        const relation = await this.driverTenantRelationRepository.create(
          {
            tenantId,
            driverId: driver.id,
            ...newRelationColumns(actorId, actorRole),
            note: input.note ?? null,
            ...(input.note ? { noteUpdatedBy: actorId, noteUpdatedAt: new Date() } : {}),
            createdBy: actorId,
          },
          txManager,
        );

        return { driver, relation };
      };

      return manager ? await run(manager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to create driver');
    }
  }

  async listDrivers(
    tenantId: string,
    input: ListDriversInput,
  ): Promise<Paginated<DriverWithRelation>> {
    try {
      const { items, total } = await this.driverTenantRelationRepository.list(tenantId, input);
      // The list loads driver.verifications only to derive licenseClass — drop the raw rows
      // (they carry IDfy's rawResponse) so the list payload stays as lean as before.
      return paginate(items.map(toListedDriver), total, input);
    } catch (error) {
      rethrow(error, 'Failed to list drivers');
    }
  }

  /**
   * My Drivers "Active Roster" — the list above narrowed by `segment`, each row carrying the
   * same licence/pay/performance/availability sections as the detail screen (so the two never
   * disagree), plus every tab's count. One tenant-wide active-load fetch feeds the on-trip/
   * available split for both the rows and the counts.
   */
  async listDriverRoster(tenantId: string, input: ListDriversInput): Promise<DriverRosterPage> {
    try {
      const activeLoadByDriver = await this.findActiveLoadByDriver(tenantId);
      const onLoadDriverIds = [...activeLoadByDriver.keys()];

      const [{ items, total }, counts] = await Promise.all([
        this.driverTenantRelationRepository.list(tenantId, input, onLoadDriverIds),
        this.driverTenantRelationRepository.countRosterSegments(tenantId, input, onLoadDriverIds),
      ]);
      const rows = await this.toRosterRows(tenantId, items, activeLoadByDriver);

      return { ...paginate(rows, total, input), counts };
    } catch (error) {
      rethrow(error, 'Failed to list drivers');
    }
  }

  /**
   * Active Roster's "Export CSV" — every roster driver matching `filters` (none from the frontend
   * today, so the whole roster) as an .xlsx, built from the same rows as GET /drivers so the file
   * and the screen never disagree. Always the roster: pending and declined links are left out.
   */
  async exportDrivers(tenantId: string, filters: ExportDriversFilters): Promise<Buffer> {
    try {
      const activeLoadByDriver = await this.findActiveLoadByDriver(tenantId);
      const relations = await this.driverTenantRelationRepository.listForExport(
        tenantId,
        { ...filters, status: 'active' },
        [...activeLoadByDriver.keys()],
        DRIVER_EXPORT_MAX_ROWS,
      );
      return await buildDriverWorkbook(
        await this.toRosterRows(tenantId, relations, activeLoadByDriver),
      );
    } catch (error) {
      rethrow(error, 'Failed to export drivers');
    }
  }

  /** Each driver's live load, from one tenant-wide fetch — feeds the on-trip/available split. */
  private async findActiveLoadByDriver(tenantId: string): Promise<Map<string, LoadEntity>> {
    const activeLoads = await this.driverAnalyticsRepository.findActiveDriverLoads(tenantId);
    const activeLoadByDriver = new Map<string, LoadEntity>();
    for (const load of activeLoads) {
      // Newest first, so the first load seen per driver wins.
      if (!activeLoadByDriver.has(load.driverId!)) activeLoadByDriver.set(load.driverId!, load);
    }
    return activeLoadByDriver;
  }

  /**
   * Roster rows — each relation flattened, with the same licence/pay/performance/availability
   * sections as the detail screen.
   */
  private async toRosterRows(
    tenantId: string,
    relations: DriverTenantRelationEntity[],
    activeLoadByDriver: Map<string, LoadEntity>,
  ): Promise<DriverRosterRow[]> {
    const driverIds = relations.map((relation) => relation.driverId);
    const [tripStats, appActivity] = await Promise.all([
      this.driverAnalyticsRepository.getTripStatsForDrivers(tenantId, driverIds),
      this.driverSessionRepository.findLastAppActivityByDriverIds(driverIds),
    ]);

    return relations.map((relation): DriverRosterRow => {
      const { verifications: _verifications, ...driver } = flattenRelation(relation);
      const {
        licence,
        contact,
        assignment,
        availability,
        performance,
        behaviour,
        appInstalled,
        appLastSeenAt,
      } = toDriverDetailSections(
        relation,
        tripStats.get(relation.driverId) ?? { total: 0, onTimePercentage: null },
        activeLoadByDriver.get(relation.driverId) ?? null,
        appActivity.get(relation.driverId) ?? null,
      );
      return {
        ...(driver as DriverWithRelation),
        licence,
        contact,
        assignment,
        availability,
        performance,
        behaviour,
        appInstalled,
        appLastSeenAt,
      };
    });
  }

  /** Driver detail screen — the flattened driver plus every screen section in one call. */
  async getDriver(tenantId: string, driverId: string): Promise<DriverDetailView> {
    try {
      const relation = await this.findRelationWithFullRelations(tenantId, driverId);
      const noteAuthorId = relation.note ? relation.noteUpdatedBy : null;
      const [{ stats }, activeLoad, appActivity, latestSession, noteAuthor] = await Promise.all([
        this.driverAnalyticsRepository.getTripStatsAndTrend(tenantId, driverId, {}),
        this.driverAnalyticsRepository.findActiveLoadForDriver(tenantId, driverId),
        this.driverSessionRepository.findLastAppActivityByDriverIds([driverId]),
        this.driverSessionRepository.findLatestSession(driverId),
        noteAuthorId
          ? this.dataSource.getRepository(UserEntity).findOne({
              where: { id: noteAuthorId },
              select: { id: true, fullName: true },
            })
          : null,
      ]);
      return {
        ...flattenRelation(relation),
        ...toDriverDetailSections(relation, stats, activeLoad, appActivity.get(driverId) ?? null),
        appDevice: latestSession
          ? { deviceType: latestSession.deviceType, deviceInfo: latestSession.deviceInfo }
          : null,
        teamNote: relation.note
          ? {
              text: relation.note,
              updatedAt: relation.noteUpdatedAt,
              updatedBy: noteAuthor ? { id: noteAuthor.id, name: noteAuthor.fullName } : null,
            }
          : null,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch driver');
    }
  }

  /** Plain flattened driver — what write endpoints return, without the detail-screen queries. */
  private async findFlattenedDriver(
    tenantId: string,
    driverId: string,
  ): Promise<DriverWithRelation> {
    return flattenRelation(await this.findRelationWithFullRelations(tenantId, driverId));
  }

  private async findRelationWithFullRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity> {
    const relation =
      await this.driverTenantRelationRepository.findByTenantAndDriverWithFullRelations(
        tenantId,
        driverId,
      );
    if (!relation) throw new NotFoundError(`Driver ${driverId} not found`);
    return relation;
  }

  async updateDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: UpdateDriverInput,
  ): Promise<DriverWithRelation> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      const licenseNumber = input.licenseNumber?.toUpperCase();
      const licenseChanged =
        licenseNumber !== undefined && licenseNumber !== relation.driver.licenseNumber;

      if (licenseChanged && licenseNumber) {
        const licenseOwner = await this.driverRepository.findByLicenseNumber(licenseNumber);
        if (licenseOwner) {
          throw new ConflictError('A driver with this license number already exists');
        }
      }

      const {
        dateOfJoining,
        salaryType,
        salaryAmount,
        fullName,
        licenseExpiry,
        dateOfBirth,
        bloodGroup,
        addressLine1,
        addressLine2,
        city,
        pinCode,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        engagementType,
        bhattaPerDay,
        advanceOutstanding,
        homeBase,
        licenseEndorsements,
        note,
      } = input;

      // The note is this fleet's own, so it goes on the relation rather than the shared profile.
      if (note !== undefined) {
        await this.driverTenantRelationRepository.update(tenantId, relation.id, {
          note,
          noteUpdatedBy: note === null ? null : actorId,
          noteUpdatedAt: note === null ? null : new Date(),
          updatedBy: actorId,
        });
      }

      await this.driverRepository.update(driverId, {
        fullName,
        licenseNumber,
        licenseVerified: licenseChanged ? false : undefined,
        licenseExpiry,
        dateOfJoining,
        salaryType,
        salaryAmount: salaryAmount === undefined ? undefined : String(salaryAmount),
        dateOfBirth,
        bloodGroup,
        addressLine1,
        addressLine2,
        city,
        pinCode,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        engagementType,
        bhattaPerDay: bhattaPerDay === undefined ? undefined : String(bhattaPerDay),
        advanceOutstanding:
          advanceOutstanding === undefined ? undefined : String(advanceOutstanding),
        homeBase,
        licenseEndorsements,
        updatedBy: actorId,
      });

      return await this.findFlattenedDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to update driver');
    }
  }

  /** Ends this tenant's relation to the driver — the shared global profile is untouched, since the
   * driver may still be linked to other tenants. */
  async deleteDriver(tenantId: string, actorId: string, driverId: string): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.driverTenantRelationRepository.softDelete(tenantId, driverId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver');
    }
  }

  async addDocument(
    tenantId: string,
    actorId: string,
    actorRole: string,
    driverId: string,
    input: AddDriverDocumentInput,
  ): Promise<DriverDocumentEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.assertDriverDlUpload(tenantId, actorRole, input.fileUrl);

      const verificationSource = input.verificationSource ?? 'manual';
      const document = await this.driverRepository.createDocument({
        tenantId,
        driverId,
        documentType: input.documentType,
        fileUrl: input.fileUrl,
        documentNumber: input.documentNumber ?? null,
        verificationSource,
        verifiedAt: null,
        createdBy: actorId,
      });
      return await this.withDocumentDownloadUrl(tenantId, actorRole, document);
    } catch (error) {
      rethrow(error, 'Failed to add driver document');
    }
  }

  async listDocuments(
    tenantId: string,
    actorRole: string,
    driverId: string,
  ): Promise<DriverDocumentEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const documents = await this.driverRepository.listDocuments(driverId);
      return await Promise.all(
        documents.map((document) => this.withDocumentDownloadUrl(tenantId, actorRole, document)),
      );
    } catch (error) {
      rethrow(error, 'Failed to list driver documents');
    }
  }

  async deleteDocument(
    tenantId: string,
    actorId: string,
    driverId: string,
    documentId: string,
  ): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findDocumentById(driverId, documentId);
      if (!existing) throw new NotFoundError(`Driver document ${documentId} not found`);
      await this.driverRepository.softDeleteDocument(driverId, documentId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver document');
    }
  }

  async recordVerification(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RecordVerificationInput,
    outerManager?: EntityManager,
  ): Promise<DriverVerificationEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId, outerManager);
      const verified = input.verificationStatus === 'verified';
      const licenseNumber = input.licenseNumber?.toUpperCase() ?? null;

      const run = async (manager: EntityManager) => {
        const verification = await this.driverRepository.createVerification(
          {
            tenantId,
            driverId,
            verificationType: input.verificationType,
            verificationStatus: input.verificationStatus,
            sourceReference: input.sourceReference ?? null,
            holderName: input.holderName ?? null,
            licenseNumber,
            validUntil: input.validUntil ?? null,
            licenseClass: input.licenseClass ?? null,
            licenseStatus: input.licenseStatus ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            pinCode: input.pinCode ?? null,
            rawResponse: input.rawResponse ?? null,
            verifiedAt: verified ? new Date() : null,
            createdBy: actorId,
          },
          manager,
        );

        // A successful check is the source of truth for the driver's licence fields.
        if (verified) {
          await this.driverRepository.update(
            driverId,
            {
              licenseVerified: true,
              licenseNumber: licenseNumber ?? undefined,
              licenseExpiry: input.validUntil ?? undefined,
              updatedBy: actorId,
            },
            manager,
          );
        }

        return verification;
      };

      return outerManager ? await run(outerManager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to record driver verification');
    }
  }

  async listVerifications(tenantId: string, driverId: string): Promise<DriverVerificationEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listVerifications(driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver verifications');
    }
  }

  async addBankDetails(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: AddBankDetailsInput,
  ): Promise<DriverBankDetailsEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const ifsc = input.ifsc.toUpperCase();
      const existing = await this.driverRepository.findBankDetailsByAccount(
        driverId,
        input.accountNumber,
        ifsc,
      );
      if (existing) {
        throw new ConflictError('This bank account is already on file for the driver');
      }

      return await this.driverRepository.createBankDetails({
        tenantId,
        driverId,
        accountNumber: input.accountNumber,
        ifsc,
        accountHolderName: input.accountHolderName ?? null,
        upiId: input.upiId ?? null,
        ...(await this.verifyBankAccountFields(input.accountNumber, ifsc)),
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add driver bank details');
    }
  }

  /** Driver-app self-service add — keyed on the driver's global id alone (no tenant relation
   *  needed, same as registration-time bank details, tenantId null). Verified against IDfy
   *  in-request, like addBankDetails. */
  async addOwnBankDetails(
    driverId: string,
    input: AddBankDetailsInput,
  ): Promise<DriverBankDetailsEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithPersonRelations(driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      const ifsc = input.ifsc.toUpperCase();
      const existing = await this.driverRepository.findBankDetailsByAccount(
        driverId,
        input.accountNumber,
        ifsc,
      );
      if (existing) {
        throw new ConflictError('This bank account is already on file for the driver');
      }

      return await this.driverRepository.createBankDetails({
        tenantId: null,
        driverId,
        accountNumber: input.accountNumber,
        ifsc,
        accountHolderName: input.accountHolderName ?? null,
        upiId: input.upiId ?? null,
        ...(await this.verifyBankAccountFields(input.accountNumber, ifsc)),
        createdBy: null,
      });
    } catch (error) {
      rethrow(error, 'Failed to add bank details');
    }
  }

  async listBankDetails(tenantId: string, driverId: string): Promise<DriverBankDetailsEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listBankDetails(driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver bank details');
    }
  }

  async setBankDetailsVerification(
    tenantId: string,
    actorId: string,
    driverId: string,
    bankDetailsId: string,
    verificationStatus: DriverBankVerificationStatus,
  ): Promise<DriverBankDetailsEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findBankDetailsById(driverId, bankDetailsId);
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);

      const bankDetails = await this.driverRepository.updateBankDetailsVerification(
        driverId,
        bankDetailsId,
        {
          verificationStatus,
          verifiedAt: verificationStatus === 'verified' ? new Date() : null,
          updatedBy: actorId,
        },
      );
      if (!bankDetails) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      return bankDetails;
    } catch (error) {
      rethrow(error, 'Failed to update driver bank details verification');
    }
  }

  async deleteBankDetails(
    tenantId: string,
    actorId: string,
    driverId: string,
    bankDetailsId: string,
  ): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findBankDetailsById(driverId, bankDetailsId);
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      await this.driverRepository.softDeleteBankDetails(driverId, bankDetailsId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver bank details');
    }
  }

  async getOperationalStatus(
    tenantId: string,
    driverId: string,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      const status = await this.driverRepository.findOperationalStatus(relation.id);
      if (!status) throw new NotFoundError(`Driver ${driverId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver operational status');
    }
  }

  /** Availability (active / on leave / medically unfit …) only means something once the driver has
   *  joined, so a pending relation is refused. Onboarding seeds the first row via
   *  writeOperationalStatus instead, since that relation is still pending. */
  async setOperationalStatus(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: SetDriverOperationalStatusInput,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      assertRelationActive(relation, 'cannot have its availability changed');
      return await this.writeOperationalStatus(tenantId, actorId, relation.id, input);
    } catch (error) {
      rethrow(error, 'Failed to set driver operational status');
    }
  }

  /** Daily DRIVER_AVAILABILITY_RETURN_JOB — drivers whose "fit to drive again from" date
   *  (`today`, India, or earlier) has come are set back to Available. */
  async returnFitDriversToAvailable(today: string): Promise<DriverAvailabilityReturnResult> {
    return { returnedToAvailable: await this.driverRepository.returnFitDriversToActive(today) };
  }

  /** One row per driver-tenant relation, so the first call inserts and later calls overwrite it. */
  private async writeOperationalStatus(
    tenantId: string,
    actorId: string,
    relationId: string,
    input: SetDriverOperationalStatusInput,
    manager?: EntityManager,
  ): Promise<DriverOperationalStatusEntity> {
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
    const existing = await this.driverRepository.findOperationalStatus(relationId);

    if (!existing) {
      return await this.driverRepository.createOperationalStatus(
        {
          tenantId,
          driverTenantRelationId: relationId,
          operationalStatus: input.operationalStatus,
          reason: input.reason ?? null,
          effectiveAt,
          availableFrom: input.availableFrom ?? null,
          createdBy: actorId,
        },
        manager,
      );
    }

    const status = await this.driverRepository.updateOperationalStatus(relationId, {
      operationalStatus: input.operationalStatus,
      reason: input.reason ?? null,
      effectiveAt,
      availableFrom: input.availableFrom ?? null,
      updatedBy: actorId,
    });
    if (!status)
      throw new NotFoundError(`Driver relation ${relationId} has no operational status yet`);
    return status;
  }

  /** Metrics are unique per reporting period, so re-reporting a period overwrites it. */
  async recordTripMetrics(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RecordDriverTripMetricsInput,
  ): Promise<DriverTripMetricsEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      assertRelationActive(relation, 'cannot have trip metrics recorded');

      if (input.periodEnd < input.periodStart) {
        throw new ValidationError('periodEnd must not be earlier than periodStart');
      }

      const onTimePercentage = String(input.onTimePercentage);
      const existing = await this.driverRepository.findTripMetricsByPeriod(
        relation.id,
        input.periodStart,
        input.periodEnd,
      );

      if (!existing) {
        return await this.driverRepository.createTripMetrics({
          tenantId,
          driverTenantRelationId: relation.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          tripsCount: input.tripsCount,
          onTimePercentage,
          createdBy: actorId,
        });
      }

      const metrics = await this.driverRepository.updateTripMetrics(existing.id, {
        tripsCount: input.tripsCount,
        onTimePercentage,
        updatedBy: actorId,
      });
      if (!metrics) throw new NotFoundError(`Trip metrics ${existing.id} not found`);
      return metrics;
    } catch (error) {
      rethrow(error, 'Failed to record driver trip metrics');
    }
  }

  async listTripMetrics(tenantId: string, driverId: string): Promise<DriverTripMetricsEntity[]> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listTripMetrics(relation.id);
    } catch (error) {
      rethrow(error, 'Failed to list driver trip metrics');
    }
  }

  /**
   * Backs the single "Save driver" button: creates the driver and every section of the form in one
   * transaction, so a failure partway through rolls the whole thing back rather than leaving a
   * half-built driver behind. Returns the driver with its relations loaded.
   */
  async onboardDriver(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: OnboardDriverInput,
  ): Promise<DriverWithRelation> {
    try {
      const { verification, bankDetails, documents, operationalStatus, ...driverInput } = input;

      // The licence lookup runs here, server-side, rather than trusting a result the client sends —
      // same as the bank check below and DriverIdentityService.completeRegistration. A result the
      // bulk-import preview fetched (and cached) a moment ago is reused instead of paying for a
      // second lookup. Outside the transaction, since the IDfy poll can take ~15s and shouldn't
      // hold it open.
      const licenceLookup =
        (await getCachedLicenceLookup(
          tenantId,
          driverInput.licenseNumber,
          driverInput.dateOfBirth,
        )) ??
        (await this.dlVerificationClient.lookupDrivingLicence(
          driverInput.licenseNumber,
          driverInput.dateOfBirth,
        ));
      const licenceVerification: RecordVerificationInput =
        licenceLookup.status === 'manual_review' && verification
          ? // Registry couldn't confirm it — keep the details staff typed in for manual review.
            { ...verification, licenseNumber: driverInput.licenseNumber }
          : toLicenceVerificationInput(licenceLookup, driverInput.licenseNumber);

      // Both DL photos are what the driver app's /register insists on before an account counts as
      // registered — with them on file, the driver lands past the app's onboarding wizard.
      const documentTypes = new Set((documents ?? []).map((document) => document.documentType));
      const appReady =
        documentTypes.has('driving_license_front') && documentTypes.has('driving_license_back');

      // Outside the transaction — the IDfy poll can take ~15s and shouldn't hold it open.
      const bankVerification = bankDetails
        ? await this.verifyBankAccountFields(
            bankDetails.accountNumber,
            bankDetails.ifsc.toUpperCase(),
          )
        : null;

      let invitationId: string | null = null;
      const driverId = await this.dataSource.transaction(async (manager) => {
        const { driver, relation } = await this.createDriver(
          tenantId,
          actorId,
          actorRole,
          {
            ...driverInput,
            // Sarathi's name wins over a typed one; the typed one only covers a nameless lookup.
            fullName: licenceLookup.holderName ?? driverInput.fullName,
            onboardingStep: appReady ? 'completed' : undefined,
          },
          manager,
        );
        if (relation.status === 'pending_driver_review') invitationId = relation.id;

        await this.recordVerification(tenantId, actorId, driver.id, licenceVerification, manager);

        for (const document of documents ?? []) {
          await this.assertDriverDlUpload(tenantId, actorRole, document.fileUrl);
          await this.driverRepository.createDocument(
            {
              tenantId,
              driverId: driver.id,
              documentType: document.documentType,
              fileUrl: document.fileUrl,
              documentNumber: document.documentNumber ?? null,
              verificationSource: document.verificationSource ?? 'manual',
              verifiedAt: null,
              createdBy: actorId,
            },
            manager,
          );
        }

        if (bankDetails) {
          await this.driverRepository.createBankDetails(
            {
              tenantId,
              driverId: driver.id,
              accountNumber: bankDetails.accountNumber,
              ifsc: bankDetails.ifsc.toUpperCase(),
              accountHolderName: bankDetails.accountHolderName ?? null,
              upiId: bankDetails.upiId ?? null,
              ...bankVerification,
              createdBy: actorId,
            },
            manager,
          );
        }

        await this.writeOperationalStatus(
          tenantId,
          actorId,
          relation.id,
          {
            operationalStatus: operationalStatus?.operationalStatus ?? 'active',
            reason: operationalStatus?.reason,
            effectiveAt: operationalStatus?.effectiveAt,
          },
          manager,
        );

        return driver.id;
      });

      const driver = await this.findFlattenedDriver(tenantId, driverId);
      await this.approvalNotifier?.requested({
        kind: 'driver',
        tenantId,
        recordId: driver.id,
        masterValue: driver.fullName,
        createdBy: driver.createdBy,
        pending: driver.status === 'pending_staff_review',
      });

      if (invitationId) await this.deliverInvite(tenantId, invitationId, driverId);

      return driver;
    } catch (error) {
      rethrow(error, 'Failed to onboard driver');
    }
  }

  /**
   * "Requests to You" — driver-initiated join requests awaiting this tenant's approval. Dispatch-
   * added drivers awaiting org_admin approval are also `pending_staff_review` but `initiatedBy:
   * 'staff'`; they surface via GET /drivers?status=pending_staff_review instead.
   */
  async listJoinRequests(
    tenantId: string,
    input: ListJoinRequestsInput,
  ): Promise<Paginated<DriverWithRelation>> {
    return this.listDrivers(tenantId, {
      ...input,
      status: 'pending_staff_review',
      initiatedBy: 'driver',
    });
  }

  /**
   * Recently Rejected — this tenant's join requests rejected in the last
   * DRIVER_JOIN_REQUEST_RESTORE_DAYS, newest first, without drivers who have since joined a fleet
   * or left Loadsmart. `callerCanApprove` is whether the caller may restore (same permission as
   * approve/reject); every listed row is otherwise restorable, so it decides `canRestore`.
   */
  async listRejectedJoinRequests(
    tenantId: string,
    input: ListJoinRequestsInput,
    callerCanApprove: boolean,
  ): Promise<Paginated<DriverRejectedJoinRequestView>> {
    try {
      const { items, total } = await this.driverTenantRelationRepository.listRejectedJoinRequests(
        tenantId,
        input,
        new Date(Date.now() - DRIVER_JOIN_REQUEST_RESTORE_DAYS * MS_PER_DAY),
      );
      const rejectorIds = [
        ...new Set(items.flatMap((relation) => (relation.rejectedBy ? [relation.rejectedBy] : []))),
      ];
      const rejectors = rejectorIds.length
        ? await this.dataSource
            .getRepository(UserEntity)
            .find({ where: { id: In(rejectorIds) }, relations: { role: true } })
        : [];
      const rejectorsById = new Map(rejectors.map((user) => [user.id, user]));

      const rows = items.map((relation): DriverRejectedJoinRequestView => {
        const rejector = relation.rejectedBy ? rejectorsById.get(relation.rejectedBy) : undefined;
        return {
          ...toListedDriver(relation),
          rejectedAt: relation.rejectedAt!,
          rejectedBy: rejector
            ? { id: rejector.id, name: rejector.fullName, role: rejector.role?.name ?? null }
            : null,
          restorableUntil: joinRequestRestorableUntil(relation.rejectedAt!),
          canRestore: callerCanApprove,
        };
      });
      return paginate(rows, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list rejected driver join requests');
    }
  }

  /**
   * Restore — a rejected join request goes back to Requests to You (`pending_staff_review`), where
   * it can be accepted; the rejection is cleared. The driver isn't notified — they only hear when
   * it's accepted. Returns the request shaped like a pending-list item.
   */
  async restoreJoinRequest(
    tenantId: string,
    actorId: string,
    driverId: string,
  ): Promise<DriverWithRelation> {
    try {
      const request = await this.driverTenantRelationRepository.findLatestByTenantAndDriver(
        tenantId,
        driverId,
      );
      if (!request || request.initiatedBy !== 'driver') {
        throw new DriverError('REQUEST_NOT_FOUND');
      }
      if (request.status !== 'rejected' || !request.rejectedAt) {
        throw new DriverError('NOT_REJECTED');
      }
      if (joinRequestRestorableUntil(request.rejectedAt) <= new Date()) {
        throw new DriverError('RESTORE_WINDOW_EXPIRED');
      }
      const [driver, driverIdsInAFleet] = await Promise.all([
        this.driverRepository.findById(driverId),
        this.driverTenantRelationRepository.findDriverIdsInAnyFleet([driverId]),
      ]);
      if (!driver || driverIdsInAFleet.has(driverId)) {
        throw new DriverError('DRIVER_UNAVAILABLE');
      }

      const restored = await this.driverTenantRelationRepository.restoreJoinRequest(
        tenantId,
        request.id,
        actorId,
      );
      if (!restored) {
        // Restored or answered by someone else in the meantime.
        throw new DriverError('NOT_REJECTED');
      }

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_JOIN_REQUEST_RESTORED',
        resourceType: 'driver',
        oldData: {
          id: driverId,
          status: 'rejected',
          rejectedAt: request.rejectedAt,
          rejectedBy: request.rejectedBy,
          rejectionReason: request.rejectionReason,
        },
        newData: { id: driverId, status: 'pending_staff_review', restoredBy: actorId },
      });

      return toListedDriver(restored);
    } catch (error) {
      rethrow(error, 'Failed to restore driver join request');
    }
  }

  /** "Invitations Sent" — every invite this tenant sent, with its derived display status. */
  async listInvitations(
    tenantId: string,
    input: ListInvitationsInput,
  ): Promise<Paginated<DriverInvitationView>> {
    try {
      const { items, total } = await this.driverTenantRelationRepository.listInvitations(
        tenantId,
        input,
      );
      const appActivity = await this.driverSessionRepository.findLastAppActivityByDriverIds(
        items.map((relation) => relation.driverId),
      );
      return paginate(
        items.map((relation) => toInvitationView(relation, appActivity.has(relation.driverId))),
        total,
        input,
      );
    } catch (error) {
      rethrow(error, 'Failed to list driver invitations');
    }
  }

  /** Invitation detail drawer — header, credentials, full timeline, delivery channels. */
  async getInvitation(tenantId: string, invitationId: string): Promise<DriverInvitationDetailView> {
    try {
      const relation = await this.findInvitationOrThrow(tenantId, invitationId);
      // Staff behind each send or cancel, and when the driver first logged into the app.
      const actorIds = [
        ...new Set(
          [
            relation.inviteSentBy,
            ...relation.inviteTimeline.map((event) => ('by' in event ? event.by : null)),
          ].filter((id): id is string => id !== null),
        ),
      ];
      const [actors, firstAppLoginAt] = await Promise.all([
        actorIds.length
          ? this.dataSource
              .getRepository(UserEntity)
              .find({ where: { id: In(actorIds) }, relations: { role: true } })
          : [],
        this.driverSessionRepository.findFirstAppLoginAt(relation.driverId),
      ]);
      return toInvitationDetailView(
        relation,
        new Map(actors.map((user) => [user.id, user])),
        firstAppLoginAt,
      );
    } catch (error) {
      rethrow(error, 'Failed to get driver invitation');
    }
  }

  /**
   * Re-sends an invite on the same row: a pending one (expired or not) or one the driver declined,
   * which goes back to pending so they can accept it. Restarts its DRIVER_INVITE_TTL_DAYS clock.
   * Accepted and cancelled invites can't be resent — each refusal says why, for the frontend.
   */
  async resendInvite(
    tenantId: string,
    actorId: string,
    invitationId: string,
  ): Promise<DriverInvitationView> {
    try {
      const invite = await this.findInvitationOrThrow(tenantId, invitationId);
      assertCanResend(invite);
      if (invite.status === 'rejected') {
        // Back to pending takes this tenant's one live slot for the driver (see the entity's
        // unique index) — refuse if a newer link already holds it.
        const latest = await this.driverTenantRelationRepository.findLatestByTenantAndDriver(
          tenantId,
          invite.driverId,
        );
        if (latest && latest.id !== invite.id) {
          throw new ConflictError('This driver already has a newer invite or request');
        }
      }

      // The decline cap is checked again on the locked row, so two Resends at once can't both
      // use the one extra send.
      const relation = await this.driverTenantRelationRepository.resendInvite(
        tenantId,
        invite.id,
        actorId,
        assertSendAllowedAfterDecline,
      );
      if (!relation) {
        throw new ConflictError('This invitation just changed — refresh and try again');
      }

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_INVITE_RESENT',
        resourceType: 'driver',
        oldData: {
          id: invite.driverId,
          invitationId,
          status: invite.status,
          inviteSentAt: invite.inviteSentAt,
        },
        newData: {
          id: invite.driverId,
          invitationId,
          status: relation.status,
          inviteSentAt: relation.inviteSentAt,
        },
      });

      await this.deliverInvite(tenantId, relation.id, relation.driverId);
      // Re-read so deliveryChannels carries the push result deliverInvite just recorded.
      const resentInvitation = await this.findInvitationOrThrow(tenantId, relation.id);

      return toInvitationView(resentInvitation, await this.hasAppInstalled(relation.driverId));
    } catch (error) {
      rethrow(error, 'Failed to resend driver invitation');
    }
  }

  /**
   * Cancel — marks this tenant's pending invite `cancelled`. It stays in Invitations Sent with
   * that status, leaves the driver's app (they can no longer accept or decline it), and blocks the
   * driver from requesting to join this tenant. Only this tenant's row changes.
   */
  async cancelInvite(tenantId: string, actorId: string, invitationId: string): Promise<void> {
    try {
      const invite = await this.findInvitationOrThrow(tenantId, invitationId);
      if (invite.status !== 'pending_driver_review') {
        throw new ConflictError('Only a pending invitation can be cancelled');
      }
      const cancelled = await this.driverTenantRelationRepository.cancelInvite(
        tenantId,
        invite.id,
        actorId,
      );
      if (!cancelled) throw new ConflictError('Invitation cancel failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_INVITE_CANCELLED',
        resourceType: 'driver',
        oldData: {
          id: invite.driverId,
          invitationId,
          status: invite.status,
          inviteSentAt: invite.inviteSentAt,
        },
        newData: { id: invite.driverId, invitationId, status: 'cancelled' },
      });
    } catch (error) {
      rethrow(error, 'Failed to cancel driver invitation');
    }
  }

  /**
   * Invitations tab → "Invite by mobile number". Only a number that already belongs to a driver —
   * added by any organisation, or registered through the driver app — can be invited; anything
   * else is refused before anything is created or sent (add them under Add a Driver first). A
   * previous expired, declined or cancelled invite is re-sent on its own row.
   */
  async inviteDriverByPhone(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: InviteDriverByPhoneInput,
  ): Promise<InviteDriverByPhoneResult> {
    try {
      const { phoneNumber } = input;
      const driver = await this.driverRepository.findByPhoneNumber(phoneNumber);
      if (!driver) throw new DriverError('DRIVER_NOT_FOUND');

      const invitationId = await this.dataSource.transaction(async (manager) => {
        const latestRelation =
          await this.driverTenantRelationRepository.findLatestByTenantAndDriver(
            tenantId,
            driver.id,
            manager,
          );
        const columns = newRelationColumns(actorId, actorRole);

        if (!latestRelation) {
          const relation = await this.driverTenantRelationRepository.create(
            { tenantId, driverId: driver.id, ...columns, createdBy: actorId },
            manager,
          );
          return relation.id;
        }

        assertCanReinvite(latestRelation);
        const relation = await this.driverTenantRelationRepository.reinvite(
          tenantId,
          latestRelation.id,
          columns,
          actorId,
          assertCanReinvite,
          manager,
        );
        if (!relation) throw new ConflictError('Invitation could not be sent');
        return relation.id;
      });

      const awaitingApproval = actorRole !== ORG_ADMIN_ROLE;
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_INVITED',
        resourceType: 'driver',
        newData: {
          id: driver.id,
          invitationId,
          phoneNumber,
          status: awaitingApproval ? 'pending_staff_review' : 'pending_driver_review',
        },
      });

      if (awaitingApproval) {
        return { driverId: driver.id, invitationId, awaitingApproval, invitation: null };
      }

      await this.deliverInvite(tenantId, invitationId, driver.id);
      const sentInvitation = await this.findInvitationOrThrow(tenantId, invitationId);
      return {
        driverId: driver.id,
        invitationId,
        awaitingApproval,
        invitation: toInvitationView(sentInvitation, await this.hasAppInstalled(driver.id)),
      };
    } catch (error) {
      rethrow(error, 'Failed to invite driver');
    }
  }

  private async hasAppInstalled(driverId: string): Promise<boolean> {
    const activity = await this.driverSessionRepository.findLastAppActivityByDriverIds([driverId]);
    return activity.has(driverId);
  }

  private async findInvitationOrThrow(
    tenantId: string,
    invitationId: string,
  ): Promise<DriverTenantRelationEntity> {
    const invite = await this.driverTenantRelationRepository.findInvitation(tenantId, invitationId);
    if (!invite) throw new NotFoundError(`Invitation ${invitationId} not found`);
    return invite;
  }

  /**
   * The single place an invite goes out to the driver (first send from onboardDriver/approveDriver,
   * and Resend). Today only push is really sent and its result recorded; SMS/WhatsApp were stamped
   * `pending` by inviteSendColumns — wire the notification branch's sending in here once merged.
   */
  private async deliverInvite(
    tenantId: string,
    invitationId: string,
    driverId: string,
    tenantName?: string | null,
  ): Promise<void> {
    const name =
      tenantName ?? (await this.organizationService.getOrganizationStatus(tenantId)).name;
    const { pushed } = await this.driverPushNotifier.notifyInvited(
      tenantId,
      driverId,
      name ?? 'A fleet owner',
      invitationId,
    );
    await this.driverTenantRelationRepository.setPushDeliveryStatus(
      invitationId,
      pushed ? 'sent' : 'failed',
    );
  }

  /**
   * WhatsApp's delivery report for an invite's latest send — `read` is the driver reading the
   * invite message, which the drawer shows as "Opened" (once per send). Not called yet: the
   * WhatsApp provider's status webhook calls this once WhatsApp sending is wired into deliverInvite.
   */
  async recordInviteWhatsAppStatus(
    invitationId: string,
    status: DriverInviteWhatsAppReportStatus,
    at: Date = new Date(),
  ): Promise<void> {
    await this.driverTenantRelationRepository.setWhatsAppDeliveryStatus(invitationId, status, at);
  }

  /**
   * Shared by this service and the fleet-link service, which needs the relation to exist before
   * linking. A relation in `rejected` status is treated as not found — a rejected driver has no
   * standing with this tenant. Callers inside a transaction must pass the manager, or the read runs
   * on another connection and cannot see a relation created moments earlier in the same
   * uncommitted transaction.
   */
  async assertDriverExists(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity & { driver: DriverEntity }> {
    try {
      const relation = await this.driverTenantRelationRepository.findByTenantAndDriver(
        tenantId,
        driverId,
        manager,
      );
      // Rejected and cancelled links give this tenant no standing over the driver.
      if (!relation || relation.status === 'rejected' || relation.status === 'cancelled') {
        throw new NotFoundError(`Driver ${driverId} not found`);
      }
      const driver = await this.driverRepository.findById(driverId, manager);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return { ...relation, driver };
    } catch (error) {
      rethrow(error, 'Failed to verify driver exists');
    }
  }

  /**
   * Approves a `pending_staff_review` relation. A dispatch-added driver (initiatedBy: 'staff') is
   * only now sent the join request (`pending_driver_review`); a driver's own join request
   * (initiatedBy: 'driver') becomes `active`.
   */
  async approveDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
  ): Promise<DriverWithRelation> {
    try {
      const existing = await this.assertDriverExists(tenantId, driverId);
      if (existing.status !== 'pending_staff_review') {
        throw new ConflictError('Only a pending driver can be approved');
      }

      const sendToDriver = existing.initiatedBy !== 'driver';
      const nextStatus = sendToDriver ? 'pending_driver_review' : 'active';
      const relation = await this.driverTenantRelationRepository.approve(
        tenantId,
        existing.id,
        actorId,
        nextStatus,
      );
      if (!relation) throw new ConflictError('Driver approval failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_APPROVED',
        resourceType: 'driver',
        oldData: { id: driverId, status: 'pending_staff_review' },
        newData: { id: driverId, status: nextStatus, approvedBy: actorId },
      });
      await this.approvalNotifier?.approved({
        kind: 'driver',
        tenantId,
        recordId: existing.driver.id,
        masterValue: existing.driver.fullName,
        createdBy: existing.createdBy,
        approvedBy: actorId,
      });

      const organization = await this.organizationService.getOrganizationStatus(tenantId);
      if (sendToDriver) {
        await this.deliverInvite(tenantId, existing.id, driverId, organization.name);
      } else {
        await this.driverPushNotifier.notifyJoinRequestApproved(
          tenantId,
          driverId,
          organization.name ?? 'the fleet owner',
        );
      }

      return await this.findFlattenedDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to approve driver');
    }
  }

  async rejectDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RejectDriverInput,
  ): Promise<DriverWithRelation> {
    const { reason, notifyDriver } = input;
    try {
      const existing = await this.assertDriverExists(tenantId, driverId);
      if (existing.status !== 'pending_staff_review') {
        throw new ConflictError('Only a pending driver can be rejected');
      }

      const relation = await this.driverTenantRelationRepository.reject(
        tenantId,
        existing.id,
        actorId,
        reason,
      );
      if (!relation) throw new ConflictError('Driver rejection failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_REJECTED',
        resourceType: 'driver',
        oldData: { id: driverId, status: 'pending_staff_review' },
        newData: { id: driverId, status: 'rejected', rejectionReason: reason },
      });
      await this.approvalNotifier?.rejected({
        kind: 'driver',
        tenantId,
        recordId: existing.driver.id,
        masterValue: existing.driver.fullName,
        createdBy: existing.createdBy,
        rejectedBy: actorId,
        reason: reason ?? 'Not specified',
      });

      // Only a driver's own join request tells them; the reject modal can switch that off.
      if (existing.initiatedBy === 'driver' && notifyDriver) {
        const organization = await this.organizationService.getOrganizationStatus(tenantId);
        await this.driverPushNotifier.notifyJoinRequestRejected(
          tenantId,
          driverId,
          organization.name ?? 'the fleet owner',
        );
      }

      return flattenRelation({ ...relation, driver: existing.driver });
    } catch (error) {
      rethrow(error, 'Failed to reject driver');
    }
  }
}
