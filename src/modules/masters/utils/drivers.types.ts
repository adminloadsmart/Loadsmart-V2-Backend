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

/** Licence photos captured on the manual Sarathi route. */
export const DRIVER_DOCUMENT_TYPES = ['driving_license_front', 'driving_license_back'] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

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
