/**
 * Maintenance value sets — declared once as `const` tuples, same pattern as masters/vehicle/
 * vehicle.type.ts, so the union type, the entity's `@Column({ enum })` and the zod schema can
 * never drift apart.
 */

/** Only these hold a workshop record with us. `attached` trucks are operated for the shipper by
 *  somebody else and hired (market) trucks never exist in masters.vehicles at all, so neither can
 *  appear anywhere on the maintenance screen (FMS-MNT-000 acceptance criterion 5). */
export const OWN_FLEET_OWNERSHIP_TYPES = ['owned', 'leased'] as const;

/** Vehicle lifecycle states that still count as part of the running fleet — pending/rejected
 *  were never onboarded and inactive has been retired. */
export const MAINTAINED_VEHICLE_STATUSES = ['active', 'under_maintenance'] as const;

/** `tyre` — a Record Tyre Maintenance entry (fitment/retread across one or more positions),
 *  always recorded after the fact; it carries the cost so tyre spend reaches the spend headline. */
export const MAINTENANCE_JOB_TYPES = ['service', 'breakdown', 'tyre'] as const;
export type MaintenanceJobType = (typeof MAINTENANCE_JOB_TYPES)[number];

/** A logged service lands `closed` straight away; only a breakdown sits `open` while the truck is
 *  in the workshop. */
export const MAINTENANCE_JOB_STATUSES = ['open', 'closed'] as const;
export type MaintenanceJobStatus = (typeof MAINTENANCE_JOB_STATUSES)[number];

/** "What was done" on Log a service. Only the SERVICE_CLOCK_TYPES restart the service interval —
 *  replacing a spare part or a repair isn't the periodic service. */
export const SERVICE_TYPES = [
  'preventive_service',
  'oil_change',
  'spare_parts',
  'repair',
  'other',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_CLOCK_TYPES: readonly ServiceType[] = ['preventive_service', 'oil_change'];

/** Record Tyre Maintenance's "Action performed". */
export const TYRE_WORK_ACTIONS = ['new_fitment', 'cold_retread'] as const;
export type TyreWorkAction = (typeof TYRE_WORK_ACTIONS)[number];

/** How a queue row's truck stands with dispatch — the "Effect on dispatch" column. Expired papers
 *  only warn at assignment (dispatch-planning.service.ts's compliance warning), they don't block. */
export const DISPATCH_EFFECTS = ['dispatchable', 'in_workshop', 'warns_on_assign'] as const;
export type DispatchEffect = (typeof DISPATCH_EFFECTS)[number];

/** PATCH /vehicles/:id/workshop-status — the plain in/out toggle, no reason or details. */
export const WORKSHOP_STATUSES = ['in_workshop', 'available'] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

/** Which clock ran out on the service policy. `no_record` — never serviced with us, so neither
 *  clock can be read; shown rather than hidden, since hiding it would be the screen lying. */
export const SERVICE_DUE_TRIGGERS = ['distance', 'time', 'both', 'no_record'] as const;
export type ServiceDueTrigger = (typeof SERVICE_DUE_TRIGGERS)[number];

export const TYRE_STATUSES = ['fitted', 'removed', 'scrapped'] as const;
export type TyreStatus = (typeof TYRE_STATUSES)[number];

export const TYRE_CASING_CONDITIONS = ['ok', 'damaged'] as const;
export type TyreCasingCondition = (typeof TYRE_CASING_CONDITIONS)[number];

export const TYRE_REMOVAL_REASONS = [
  'retread',
  'scrap',
  'rotation',
  'damage',
  'replaced',
  'other',
] as const;
export type TyreRemovalReason = (typeof TYRE_REMOVAL_REASONS)[number];

export const TYRE_NEXT_STEPS = ['retread', 'new_tyre', 'scrap'] as const;
export type TyreNextStep = (typeof TYRE_NEXT_STEPS)[number];

/** Whose problem it is when a pack crosses its warranty SoH floor: before warranty end it is the
 *  manufacturer's, after it is a capital call the shipper needs to have seen coming. */
export const BATTERY_VERDICTS = ['manufacturer', 'capital_call', 'insufficient_data'] as const;
export type BatteryVerdict = (typeof BATTERY_VERDICTS)[number];

export const FIXED_COST_SOURCES = ['fixed', 'emi', 'none'] as const;
export type FixedCostSource = (typeof FIXED_COST_SOURCES)[number];
