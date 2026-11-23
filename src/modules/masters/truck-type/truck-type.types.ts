/**
 * The 3-step truck-type picker's body-type list (Plan Dispatch v2.0 §6.6) — declared once as a
 * `const` tuple, same pattern as vehicle.type.ts's BODY_TYPES, so the entity's
 * `@Column({ enum: [...] })` and the validators can never drift apart. Distinct from
 * masters/vehicle/vehicle.type.ts's BODY_TYPES (a vehicle's own attribute, 5 values) — this is the
 * Truck Master's own, more detailed catalog of 10 chassis classes.
 */
export const TRUCK_BODY_TYPES = [
  'open_body',
  'container',
  'lcv_open_body',
  'lcv_container',
  'trailer_dala_body',
  'trailer_flat_bed',
  'tanker',
  'tipper',
  'bulker',
  'mini_pickup',
] as const;
export type TruckBodyType = (typeof TRUCK_BODY_TYPES)[number];

/**
 * The body classes the client's truck-type list (TRUCK_TYPE_PICKER_ROWS) still uses. The others in
 * TRUCK_BODY_TYPES stay only because the Postgres enum and retired (soft-deleted) rows carry them;
 * validators accept just these.
 */
export const ACTIVE_TRUCK_BODY_TYPES = [
  'open_body',
  'container',
  'lcv_open_body',
  'lcv_container',
] as const satisfies readonly TruckBodyType[];
