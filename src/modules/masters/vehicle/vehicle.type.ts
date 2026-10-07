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

/** Axle/wheel configurations offered in the fleet form — also reused by the truck-type catalog
 *  (masters/truck-type-catalog/truck-type-catalog-configurations.constants.ts), which is why 4 (LCVs) and 22
 *  (multi-axle trailers) are included even though they're rarer on a typical own-fleet vehicle. */
export const WHEEL_COUNTS = [4, 6, 10, 12, 14, 16, 18, 22] as const;
export type VehicleWheelCount = (typeof WHEEL_COUNTS)[number];

/**
 * How the vehicle is held. The Add Truck drawer offers owned (in your name, no loan), financed (in
 * your name, with a loan) and attached (leased from another owner). `leased` predates that split
 * and is kept only so existing rows stay valid — new trucks aren't onboarded with it.
 */
export const OWNERSHIP_TYPES = ['owned', 'financed', 'leased', 'attached'] as const;
export type VehicleOwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** The ownership types the Add Truck drawer offers — see OWNERSHIP_TYPES for why `leased` isn't one. */
export const ONBOARD_OWNERSHIP_TYPES = ['owned', 'financed', 'attached'] as const;

/**
 * The truck-type picker's step 2 for 32 ft containers, which are sold by axle rather than tyre
 * count: single axle (plus its 9.5 ft / 10 ft high-cube variants), multi axle and triple axle.
 */
export const AXLE_TYPES = ['sxl', 'sxl_hc_9_5', 'sxl_hc_10', 'mxl', 'txl'] as const;
export type VehicleAxleType = (typeof AXLE_TYPES)[number];

/** Tyre count stored on the vehicle for an axle-typed container, so the maintenance tyre layout
 *  (maintenance/calculations/tyre-layout.ts) works off wheelCount the same as any other truck. */
export const AXLE_TYPE_WHEEL_COUNTS: Record<VehicleAxleType, number> = {
  sxl: 6,
  sxl_hc_9_5: 6,
  sxl_hc_10: 6,
  mxl: 10,
  txl: 14,
};

/** Who pays a running cost on an attached truck — "you" in the drawer is `self`. */
export const COST_PAYERS = ['self', 'owner', 'driver'] as const;
export type VehicleCostPayer = (typeof COST_PAYERS)[number];

/** Tolls are paid by the fleet or the owner, never the driver. */
export const TOLL_PAYERS = ['self', 'owner'] as const;
export type VehicleTollPayer = (typeof TOLL_PAYERS)[number];

/**
 * Tyre life's "Set the whole set first" options → the tread depth (mm) every position starts at.
 * These are estimates, not gauge readings — the readings they create are flagged `is_estimated`.
 */
export const TYRE_CONDITION_PRESETS = {
  new: 14,
  mostly_good: 10,
  half_worn: 7,
  near_replacement: 4,
} as const;
export type TyreConditionPreset = keyof typeof TYRE_CONDITION_PRESETS;
export const TYRE_CONDITION_PRESET_KEYS = Object.keys(TYRE_CONDITION_PRESETS) as [
  TyreConditionPreset,
  ...TyreConditionPreset[],
];

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
 * Vehicle paperwork. The first six are the dated papers the compliance column reads;
 * `rc_front` / `rc_back` are the RC photos captured on the manual VAHAN route and carry no expiry.
 */
export const VEHICLE_DOCUMENT_TYPES = [
  'rc',
  'insurance',
  'permit',
  'puc',
  'fitness',
  'road_tax',
  'rc_front',
  'rc_back',
] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

/** The 6 dated papers the compliance column actually tracks — excludes rc_front/rc_back, the
 * undated RC photos. Scopes filters (e.g. compliance alerts) to types that can carry an expiry. */
export const VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY = [
  'rc',
  'insurance',
  'permit',
  'puc',
  'fitness',
  'road_tax',
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
