/**
 * Vehicle-side value sets. Each is declared once here as a `const` tuple and everything else
 * derives from it — the union type below, the entity's `@Column({ enum: [...] })` and the request
 * schema in masters.validators.ts — so the three can never drift apart.
 */

/** Fuel the vehicle runs on. */
export const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'] as const;
export type VehicleFuelType = (typeof FUEL_TYPES)[number];

/** Body style, independent of truck type (see TruckTypeEntity) — a 32ft chassis can be open or closed. */
export const BODY_TYPES = ['open', 'closed', 'flat_bed', 'container', 'low_bed'] as const;
export type VehicleBodyType = (typeof BODY_TYPES)[number];

/** Axle/wheel configurations offered in the fleet form. */
export const WHEEL_COUNTS = [6, 10, 12, 14, 16, 18] as const;
export type VehicleWheelCount = (typeof WHEEL_COUNTS)[number];

/** How the vehicle is held: owned outright, on lease, or attached from a third-party operator. */
export const OWNERSHIP_TYPES = ['owned', 'leased', 'attached'] as const;
export type VehicleOwnershipType = (typeof OWNERSHIP_TYPES)[number];

/**
 * Lifecycle state of the vehicle record, distinct from its live `operationalStatus`. `pending`/
 * `rejected` back the approval flow: org_admin's own onboardVehicle calls land straight on
 * `active`; dispatch's (the only other role allowed to add a vehicle — see masters.routes.ts's
 * canWrite gate) land on `pending` until an org_admin approves or rejects via
 * PATCH /vehicles/{id}/approve|reject.
 */
export const VEHICLE_STATUSES = [
  'active',
  'inactive',
  'under_maintenance',
  'pending',
  'rejected',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/**
 * Vehicle paperwork. The first five are the dated papers the compliance column reads;
 * `rc_front` / `rc_back` are the RC photos captured on the manual VAHAN route and carry no expiry.
 */
export const VEHICLE_DOCUMENT_TYPES = [
  'rc',
  'insurance',
  'permit',
  'puc',
  'fitness',
  'rc_front',
  'rc_back',
] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

/** The 5 dated papers the compliance column actually tracks — excludes rc_front/rc_back, the
 * undated RC photos. Scopes filters (e.g. compliance alerts) to types that can carry an expiry. */
export const VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY = [
  'rc',
  'insurance',
  'permit',
  'puc',
  'fitness',
] as const;
export type VehicleDocumentTypeWithExpiry = (typeof VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY)[number];

/** Derived from the document's expiry date — see resolveDocumentStatus in vehicle.service.ts. */
export const VEHICLE_DOCUMENT_STATUSES = ['valid', 'expiring_soon', 'expired'] as const;
export type VehicleDocumentStatus = (typeof VEHICLE_DOCUMENT_STATUSES)[number];

/** What the vehicle is doing right now. `warn_on_assign` flags a truck that is assignable but has a compliance problem. */
export const VEHICLE_OPERATIONAL_STATUSES = [
  'on_trip',
  'idle',
  'warn_on_assign',
  'inactive',
] as const;
export type VehicleOperationalStatus = (typeof VEHICLE_OPERATIONAL_STATUSES)[number];

/** Vehicles are checked against the VAHAN registry. */
export const VEHICLE_VERIFICATION_TYPES = ['vahan'] as const;
export type VehicleVerificationType = (typeof VEHICLE_VERIFICATION_TYPES)[number];

export const VEHICLE_VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'not_found',
  'manual_review',
] as const;
export type VehicleVerificationStatus = (typeof VEHICLE_VERIFICATION_STATUSES)[number];
