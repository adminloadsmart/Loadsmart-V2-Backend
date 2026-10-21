import type { VehicleImportErrorCode } from '../masters/vehicle/vehicle-import.errors';

/**
 * Driver-side value sets. Each is declared once here as a `const` tuple and everything else
 * derives from it — the union type below, the entity's `@Column({ enum: [...] })` and the request
 * schema in masters.validators.ts — so the three can never drift apart.
 */

/**
 * Lifecycle state of the driver record, distinct from their live `operationalStatus`. `pending`/
 * `rejected` back the approval flow: org_admin's own onboardDriver calls land straight on
 * `active`; dispatch's (the only other role allowed to add a driver — see masters.routes.ts's
 * canWrite gate) land on `pending` until an org_admin approves or rejects via
 * PATCH /drivers/{id}/approve|reject.
 */
export const DRIVER_STATUSES = [
  'active',
  'inactive',
  'on_trip',
  'on_leave',
  'pending',
  'rejected',
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/** Licence photos (manual Sarathi route) plus ID-proof uploads (Aadhaar/PAN). */
export const DRIVER_DOCUMENT_TYPES = [
  'driving_license_front',
  'driving_license_back',
  'aadhaar',
  'pan',
] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] as const;
export type DriverBloodGroup = (typeof DRIVER_BLOOD_GROUPS)[number];

export const DRIVER_SALARY_TYPES = ['fixed', 'per_trip', 'per_km'] as const;
export type DriverSalaryType = (typeof DRIVER_SALARY_TYPES)[number];

/**
 * How the driver is engaged — the "Engagement" choice on the Add-a-driver form (On-roll salaried /
 * Per trip / Vendor's driver). Deliberately separate from DRIVER_SALARY_TYPES: that's how they're
 * paid, this is how they're employed (a vendor's driver can still be paid per trip).
 */
export const DRIVER_ENGAGEMENT_TYPES = ['on_roll', 'per_trip', 'vendor'] as const;
export type DriverEngagementType = (typeof DRIVER_ENGAGEMENT_TYPES)[number];

/**
 * Licence endorsements a driver can hold — stored as codes in drivers.license_endorsements
 * (varchar[]), so adding one here needs no migration. Only Hazmat is on the screen so far.
 */
export const DRIVER_LICENSE_ENDORSEMENTS = ['hazmat'] as const;
export type DriverLicenseEndorsement = (typeof DRIVER_LICENSE_ENDORSEMENTS)[number];

/** Whether the document came from the registry or was uploaded by hand. */
export const DRIVER_DOCUMENT_VERIFICATION_SOURCES = ['sarathi', 'manual'] as const;
export type DriverDocumentVerificationSource =
  (typeof DRIVER_DOCUMENT_VERIFICATION_SOURCES)[number];

/** Drivers are checked against the Sarathi registry. */
export const DRIVER_VERIFICATION_TYPES = ['sarathi_dl'] as const;
export type DriverVerificationType = (typeof DRIVER_VERIFICATION_TYPES)[number];

export const DRIVER_VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'not_found',
  'manual_review',
] as const;
export type DriverVerificationStatus = (typeof DRIVER_VERIFICATION_STATUSES)[number];

export const DRIVER_BANK_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type DriverBankVerificationStatus = (typeof DRIVER_BANK_VERIFICATION_STATUSES)[number];

/** What the driver is doing right now — the status dropdown on the My Drivers table.
 * `on_leave`/`medically_unfit` = not available; `inactive` = left the company. */
export const DRIVER_OPERATIONAL_STATUSES = [
  'active',
  'on_trip',
  'on_leave',
  'medically_unfit',
  'inactive',
] as const;
export type DriverOperationalStatus = (typeof DRIVER_OPERATIONAL_STATUSES)[number];

/**
 * Lifecycle of a driver's link to one tenant (masters.driver_tenant_relations). Replaces the old
 * per-tenant DriverEntity.status now that a driver profile is global and can hold many of these.
 * `pending_staff_review` covers both a dispatch-added driver awaiting org_admin approval AND a
 * driver-initiated join request awaiting staff approval — `initiatedBy` disambiguates which,
 * but the approve/reject action is identical for both. `pending_driver_review` is a fleet-owner-
 * initiated invite awaiting the driver's acceptance. `cancelled` is such an invite the fleet owner
 * withdrew: the row is kept (Invitations Sent shows it) and it blocks the driver from requesting to
 * join this tenant — every status is per tenant+driver row, so the driver's other tenants are
 * never affected.
 */
export const DRIVER_TENANT_RELATION_STATUSES = [
  'pending_staff_review',
  'pending_driver_review',
  'active',
  'rejected',
  'cancelled',
] as const;
export type DriverTenantRelationStatus = (typeof DRIVER_TENANT_RELATION_STATUSES)[number];

/**
 * GET /drivers `status`. Omitted = `active` — the roster: every driver who joined, including those
 * who later left (left = operational status `inactive`, the relation stays `active`). `all` drops
 * the status filter, so pending/declined/cancelled links come back too.
 */
export const DRIVER_LIST_STATUS_FILTERS = [...DRIVER_TENANT_RELATION_STATUSES, 'all'] as const;
export type DriverListStatusFilter = (typeof DRIVER_LIST_STATUS_FILTERS)[number];

/**
 * "Active Roster" tab bar on My Drivers. Every segment except `left_company` excludes drivers
 * whose company status is `inactive` (left), so `all` is the roster and the rest are slices of it
 * that can overlap (an on-trip driver can also be licence-expired). `on_trip`/`available` use the
 * live active-load check, not the stored operational status — load assignment never updates the
 * latter. `not_available` = on_leave or medically_unfit; `hazmat_endorsed` = 'hazmat' in
 * drivers.license_endorsements.
 */
/**
 * Roster filter panel (GET /drivers), each sent as a comma-separated list. "Employment":
 * `fixed`/`per_trip`/`per_km` are how a company driver is paid (drivers.salary_type) and `vendor`
 * is a vendor's driver (engagement_type), so a vendor's driver only ever matches `vendor` — the
 * same split the roster's Pay column shows.
 */
export const DRIVER_ROSTER_EMPLOYMENT_FILTERS = ['fixed', 'per_trip', 'per_km', 'vendor'] as const;
export type DriverRosterEmploymentFilter = (typeof DRIVER_ROSTER_EMPLOYMENT_FILTERS)[number];

/** `expiring` = 0-30 days left, `valid` = more than 30, `expired` = past — the roster's own
 *  licence-validity labels. A driver with no expiry on file matches none of them. */
export const DRIVER_LICENCE_VALIDITY_FILTERS = ['valid', 'expiring', 'expired'] as const;
export type DriverLicenceValidityFilter = (typeof DRIVER_LICENCE_VALIDITY_FILTERS)[number];

/** Classes of vehicle the filter panel offers, matched against the latest Sarathi check. */
export const DRIVER_LICENCE_CLASS_FILTERS = ['HTV', 'HMV', 'HGMV'] as const;
export type DriverLicenceClassFilter = (typeof DRIVER_LICENCE_CLASS_FILTERS)[number];

/** Score badge — `new` until MIN_SCORED_TRIPS trips and a score (see driver.service.ts). */
export const DRIVER_SCORE_STATUSES = ['new', 'strong', 'watch'] as const;
export type DriverScoreStatus = (typeof DRIVER_SCORE_STATUSES)[number];

export const DRIVER_ROSTER_SEGMENTS = [
  'all',
  'on_trip',
  'available',
  'not_available',
  'left_company',
  'licence_expired',
  'hazmat_endorsed',
  'not_verified',
] as const;
export type DriverRosterSegment = (typeof DRIVER_ROSTER_SEGMENTS)[number];

/** How long a tenant's invite stays acceptable after it's sent (or re-sent). */
export const DRIVER_INVITE_TTL_DAYS = 7;

/**
 * "Invitations Sent" display status — derived from a tenant-initiated relation, never stored:
 * pending = pending_driver_review & not yet expired, expired = pending_driver_review past
 * invite_expires_at, accepted = active, rejected = declined by the driver, cancelled = withdrawn
 * by the fleet owner.
 */
export const DRIVER_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type DriverInvitationStatus = (typeof DRIVER_INVITATION_STATUSES)[number];

/**
 * Why an invitation reads `expired`: the 7-day window ran out, or the driver is no longer active
 * on the platform (today: deleted their own account — see isDriverOffPlatform).
 */
export const DRIVER_INVITATION_EXPIRY_REASONS = ['invite_timeout', 'driver_inactive'] as const;
export type DriverInvitationExpiryReason = (typeof DRIVER_INVITATION_EXPIRY_REASONS)[number];

/**
 * Per-channel delivery state of an invite's latest send. `delivered`/`read` are reserved for
 * provider delivery webhooks (MSG91), which don't exist yet.
 */
export const DRIVER_INVITE_DELIVERY_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export type DriverInviteDeliveryStatus = (typeof DRIVER_INVITE_DELIVERY_STATUSES)[number];

/** Channels an invite goes out on — one deliveryChannels entry each. */
export const DRIVER_INVITE_CHANNELS = ['sms', 'whatsapp', 'push'] as const;
export type DriverInviteChannel = (typeof DRIVER_INVITE_CHANNELS)[number];

/** Timeline steps that are a send of the invite: the first one, then every Resend/re-invite. */
export const DRIVER_INVITE_SEND_STEPS = ['sent', 'resent'] as const;
export type DriverInviteSendStep = (typeof DRIVER_INVITE_SEND_STEPS)[number];

/** Who created the driver_tenant_relations row. */
export const DRIVER_TENANT_RELATION_INITIATORS = ['staff', 'driver', 'fleet_owner'] as const;
export type DriverTenantRelationInitiator = (typeof DRIVER_TENANT_RELATION_INITIATORS)[number];

/** Whether the global driver profile came from the driver's own registration or staff onboarding. */
export const DRIVER_REGISTRATION_SOURCES = ['self', 'staff_created'] as const;
export type DriverRegistrationSource = (typeof DRIVER_REGISTRATION_SOURCES)[number];

/**
 * Self-registration's 3-screen wizard progress — a driver-app-only resume-position bookmark, not
 * a computed business rule. Screens 2/3's own fields (emergency info, bank details) are all
 * optional, so "has screen 2 been completed" can't be inferred from data presence alone (the
 * driver could tap Continue with nothing filled in); the client reports its own progress on each
 * POST /register call instead — see RegisterDriverInput.onboardingStep.
 */
export const DRIVER_ONBOARDING_STEPS = [
  'identity_verification',
  'emergency_information',
  'bank_details',
  'completed',
] as const;
export type DriverOnboardingStep = (typeof DRIVER_ONBOARDING_STEPS)[number];

/** Answers on the driver app's Insurance screen — "Do you have health/life insurance?". */
export const DRIVER_INSURANCE_ANSWERS = ['yes', 'no', 'dont_know'] as const;
export type DriverInsuranceAnswer = (typeof DRIVER_INSURANCE_ANSWERS)[number];

/** Same codes as the vehicle import, so the frontend renders both reports the same way. */
export type DriverImportErrorCode = VehicleImportErrorCode;
