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

/** What the driver is doing right now — the status dropdown on the My Drivers table. */
export const DRIVER_OPERATIONAL_STATUSES = ['active', 'on_trip', 'on_leave', 'inactive'] as const;
export type DriverOperationalStatus = (typeof DRIVER_OPERATIONAL_STATUSES)[number];

/**
 * Lifecycle of a driver's link to one tenant (masters.driver_tenant_relations). Replaces the old
 * per-tenant DriverEntity.status now that a driver profile is global and can hold many of these.
 * `pending_staff_review` covers both a dispatch-added driver awaiting org_admin approval AND a
 * driver-initiated join request awaiting staff approval — `initiatedBy` disambiguates which,
 * but the approve/reject action is identical for both. `pending_driver_review` is a fleet-owner-
 * initiated invite awaiting the driver's acceptance.
 */
export const DRIVER_TENANT_RELATION_STATUSES = [
  'pending_staff_review',
  'pending_driver_review',
  'active',
  'rejected',
] as const;
export type DriverTenantRelationStatus = (typeof DRIVER_TENANT_RELATION_STATUSES)[number];

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
