/**
 * Vehicle-side value sets. Each is declared once here as a `const` tuple and everything else
 * derives from it — the union type below, the entity's `@Column({ enum: [...] })` and the request
 * schema in masters.validators.ts — so the three can never drift apart.
 */

/**
 * The fixed set of vehicle types the fleet supports. Rated tonnage is indicative only — the
 * per-vehicle figure lives in `capacityTons`.
 */
export const VEHICLE_TYPES = [
  '32ft_multi_axle',
  '32ft_single_axle',
  '24ft_open_10_wheel',
  '22ft_closed',
  '20ft_flat_bed',
  '17ft_open_6_wheel',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** Fuel the vehicle runs on. */
export const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'] as const;
export type VehicleFuelType = (typeof FUEL_TYPES)[number];

/** Body style, independent of `VEHICLE_TYPES` — a 32ft chassis can be open or closed. */
export const BODY_TYPES = ['open', 'closed', 'flat_bed', 'container', 'low_bed'] as const;
export type VehicleBodyType = (typeof BODY_TYPES)[number];

/** Axle/wheel configurations offered in the fleet form. */
export const WHEEL_COUNTS = [6, 10, 12, 14, 16, 18] as const;
export type VehicleWheelCount = (typeof WHEEL_COUNTS)[number];

/** How the vehicle is held: owned outright, on lease, or attached from a third-party operator. */
export const OWNERSHIP_TYPES = ['owned', 'leased', 'attached'] as const;
export type VehicleOwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** Lifecycle state of the vehicle record, distinct from its live `operationalStatus`. */
export const VEHICLE_STATUSES = ['active', 'inactive', 'under_maintenance'] as const;
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
