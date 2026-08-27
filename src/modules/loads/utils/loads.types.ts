/**
 * Load module value sets — each declared once as a `const` tuple, same pattern as
 * masters/utils/vehicle.type.ts, so the entity's `@Column({ enum: [...] })`, validators and
 * services can never drift apart.
 */

export const REQUISITION_STATUSES = ['open', 'fully_dispatched', 'closed'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

/** The "Unit" dropdown on a requisition's product line (Plan Dispatch v2.0 §4.1) — a convenience
 *  quantity is entered in one of these and converted to tonnage via the product's weight per
 *  pack; 'tonnes' copies the quantity straight into tonnage. */
export const REQUISITION_ITEM_UNITS = [
  'tonnes',
  'bags',
  'boxes',
  'cartons',
  'drums',
  'pallets',
  'pieces',
] as const;
export type RequisitionItemUnit = (typeof REQUISITION_ITEM_UNITS)[number];

export const LOAD_SOURCE_TYPES = ['own_fleet', 'market'] as const;
export type LoadSourceType = (typeof LOAD_SOURCE_TYPES)[number];

export const FREIGHT_TYPES = ['per_ton', 'flat'] as const;
export type FreightType = (typeof FREIGHT_TYPES)[number];

/** Market truck lines only, chosen at Dispatch Planning (Plan Dispatch v2.0 §6.3/R-16):
 *  `set_expected_price` requires a target rate; `ask_for_quotes` leaves the rate open until
 *  Assignment. */
export const FREIGHT_MODES = ['set_expected_price', 'ask_for_quotes'] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];

/** Advisory-only fit verdicts (never block — see loads/utils/fit-engine.ts). Weight-based only in
 *  this build; deck-volume/"cubes out" checks are deferred pending structured product dimensions. */
export const FIT_VERDICTS = [
  'good_fit',
  'some_unused_capacity',
  'smaller_vehicle_available',
] as const;
export type FitVerdict = (typeof FIT_VERDICTS)[number];

/**
 * The load's single, unified movement status — Advance/Balance payment are tracked
 * separately (LoadEntity.advancePaidAt/balancePaidAt) since they run in
 * parallel with movement rather than block it; see loads/entities/load.entity.ts's doc comment.
 *
 * Order is significant: LoadService.updateStatus walks this array by index to reject skipping
 * ahead or moving backward through the manual tracking stages.
 */
export const LOAD_STATUSES = [
  'created',
  'assigned',
  'loading_confirmed',
  'at_plant',
  'in_transit',
  'reached_delivery_point',
  'delivered',
  'closed',
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/** Trips Home-page tab boundary — a delivered-but-unsettled market load already reads as
 *  "no longer active" rather than "done", so 'delivered' groups with 'closed'. Both derive from
 *  LOAD_STATUSES by filtering, so they can't drift out of sync with the canonical order above. */
export const COMPLETED_LOAD_STATUSES: readonly LoadStatus[] = ['delivered', 'closed'];
export const ACTIVE_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => !COMPLETED_LOAD_STATUSES.includes(status),
);
export const LOAD_STATUS_GROUPS = ['active', 'completed'] as const;
export type LoadStatusGroup = (typeof LOAD_STATUS_GROUPS)[number];

/**
 * Plan Dispatch v2.0 §11/R-38 — each sourcing strategy has its own customer/dispatcher-facing
 * lifecycle length (Own Fleet 4 stages, Market Fleet 6; Loadsmart's 9 has no equivalent yet since
 * that sourcing strategy doesn't exist in this build — see LOAD_SOURCE_TYPES above). This sits
 * alongside, not instead of, LOAD_STATUSES above — loading_confirmed/at_plant remain real,
 * separately-timestamped statuses the trip-detail screen's technical stepper still tracks
 * (load.service.ts's buildStepper, unchanged), but the doc's simplified lifecycle folds both into
 * the preceding stage rather than counting them on their own. Consumed only by
 * load.service.ts's resolveLifecycleStage/buildNextAction.
 */
export const OWN_FLEET_LIFECYCLE_STATUSES: readonly LoadStatus[] = [
  'assigned',
  'in_transit',
  'reached_delivery_point',
  'delivered',
];

export const MARKET_LIFECYCLE_STATUSES: readonly LoadStatus[] = [
  'created',
  'assigned',
  'in_transit',
  'reached_delivery_point',
  'delivered',
];

/** Market Fleet's 6th doc stage ("Payments") isn't a LoadStatus at all — advance/balance run in
 *  parallel with movement rather than block it (see LoadEntity's doc comment), so it's a derived
 *  pseudo-stage keyed off advancePaidAt/balancePaidAt, not a status value. Own Fleet has no
 *  equivalent (R-17: "Own-fleet movements carry no freight, advance or balance"). */
export const PAYMENTS_STAGE = 'payments' as const;

/** Doc-exact wording (Plan Dispatch v2.0 §11) for the stage a load is currently "at". Rows for
 *  loading_confirmed/at_plant/closed intentionally repeat their collapsed target's label — see
 *  load.service.ts's resolveLifecycleStage, the only place that does the collapsing. */
export const LIFECYCLE_STAGE_LABELS: Record<LoadStatus | typeof PAYMENTS_STAGE, string> = {
  created: 'Load created',
  assigned: 'Truck assigned',
  loading_confirmed: 'Truck assigned',
  at_plant: 'Truck assigned',
  in_transit: 'In-transit',
  reached_delivery_point: 'Reached unloading point',
  delivered: 'Delivered',
  closed: 'Delivered',
  payments: 'Payments',
};

/** The subset of LOAD_STATUSES settable via PATCH /loads/:id/status (manual tracking —
 *  this build has no GPS/geofence automation).
 *  'delivered' is only reachable via uploadPod(); 'closed' only via the payment/POD flows. */
export const MANUAL_TRACKING_STATUSES = [
  'at_plant',
  'in_transit',
  'reached_delivery_point',
] as const;
export type ManualTrackingStatus = (typeof MANUAL_TRACKING_STATUSES)[number];

export const LOAD_ACTIVITY_ACTIONS = [
  'LOAD_CREATED',
  'STATUS_CHANGED',
  'DOCUMENT_UPLOADED',
  'PAYMENT_RECORDED',
] as const;
export type LoadActivityAction = (typeof LOAD_ACTIVITY_ACTIONS)[number];

export const LOAD_PAYMENT_TYPES = ['advance', 'balance'] as const;
export type LoadPaymentType = (typeof LOAD_PAYMENT_TYPES)[number];
