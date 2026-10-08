/**
 * Load module value sets — each declared once as a `const` tuple, same pattern as
 * masters/vehicle/vehicle.type.ts, so the entity's `@Column({ enum: [...] })`, validators and
 * services can never drift apart.
 */

import type { MessageKey } from '../../../shared/i18n/translate';

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

/** E-POD's seal-check field — captured alongside the delivery receipt, never blocks `uploadPod`.
 *  A 'broken' seal has no escalation workflow to route to yet (no exceptions/escalations module
 *  exists in this build); it's recorded on the load's activity/audit trail so it's visible, not
 *  acted on automatically — see load.service.ts's uploadPod. */
export const SEAL_STATUSES = ['intact', 'broken'] as const;
export type SealStatus = (typeof SEAL_STATUSES)[number];

/** E-POD's cargo-condition-on-arrival field — captured alongside the delivery receipt. A
 *  'damage'/'wet'/'both' value requires a damagePhotoKey (see load.validators.ts's uploadPodBody);
 *  'shortage'/'both' pairs with the optional numberOfTonnesShort. Like sealStatus, never blocks
 *  uploadPod — recorded for visibility, no escalation workflow exists yet. */
export const SHORTAGE_OR_DAMAGE_STATUSES = ['none', 'shortage', 'damage', 'wet', 'both'] as const;
export type ShortageOrDamageStatus = (typeof SHORTAGE_OR_DAMAGE_STATUSES)[number];

/** E-POD's staff-review state — set to 'pending' by uploadPod, then decided by
 *  LoadService.reviewPod. null before any E-POD has ever been uploaded. A load only reaches
 *  'closed' once this is 'accepted' — see load.entity.ts's doc comment and LoadService.closeLoad/
 *  reviewPod. 'rejected' lets the driver resubmit via the same uploadPod endpoint, which resets
 *  this back to 'pending'. */
export const POD_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type PodStatus = (typeof POD_STATUSES)[number];

/** The two outcomes a staff reviewer can pick on a pending E-POD — see LoadService.reviewPod. */
export const POD_REVIEW_DECISIONS = ['accepted', 'rejected'] as const;
export type PodReviewDecision = (typeof POD_REVIEW_DECISIONS)[number];

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
  'at_plant',
  'loading_confirmed',
  'in_transit',
  'reached_delivery_point',
  'delivered',
  'closed',
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/** Trips Home-page tab boundary — 'delivered' is deliberately NOT completed: a load only counts
 *  as done once staff has accepted its E-POD (and, for market loads, both advance and balance are
 *  paid) and LoadService.closeLoad has actually flipped it to 'closed' — see load.entity.ts's doc
 *  comment. A delivered-but-not-yet-accepted load reads as active/open, same as a load still
 *  in-transit, so it stays visible until someone actually reviews it. Derives from LOAD_STATUSES
 *  by filtering, so it can't drift out of sync with the canonical order above. */
export const COMPLETED_LOAD_STATUSES: readonly LoadStatus[] = ['closed'];
export const ACTIVE_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => !COMPLETED_LOAD_STATUSES.includes(status),
);
/** Driver-app "Open Trips" tab — every status except 'closed', i.e. active loads plus a
 *  'delivered' load still awaiting/failing E-POD review. Named separately from
 *  ACTIVE_LOAD_STATUSES (even though the two sets are equal today) since they serve different
 *  audiences — staff's Active tab vs. the driver's Open Trips tab — and may diverge later. */
export const OPEN_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => status !== 'closed',
);
/** Driver-app "Upcoming" tab — assigned to the driver but not yet moving. */
export const UPCOMING_LOAD_STATUSES: readonly LoadStatus[] = ['created', 'assigned'];
export const LOAD_STATUS_GROUPS = ['active', 'completed', 'open', 'upcoming'] as const;
export type LoadStatusGroup = (typeof LOAD_STATUS_GROUPS)[number];
export const LOAD_STATUS_GROUP_FILTERS: Record<LoadStatusGroup, readonly LoadStatus[]> = {
  active: ACTIVE_LOAD_STATUSES,
  completed: COMPLETED_LOAD_STATUSES,
  open: OPEN_LOAD_STATUSES,
  upcoming: UPCOMING_LOAD_STATUSES,
};

/**
 * Plan Dispatch v2.0 §11/R-38 — each sourcing strategy has its own customer/dispatcher-facing
 * lifecycle length (Own Fleet 4 stages, Market Fleet 6; Loadsmart's 9 has no equivalent yet since
 * that sourcing strategy doesn't exist in this build — see LOAD_SOURCE_TYPES above). This sits
 * alongside, not instead of, LOAD_STATUSES above — loading_confirmed/at_plant remain real,
 * separately-timestamped statuses the trip-detail screen's technical stepper still tracks
 * (utils/trip-view.ts's buildStepper, unchanged), but the doc's simplified lifecycle folds both
 * into the preceding stage rather than counting them on their own. Consumed only by
 * utils/trip-view.ts's resolveLifecycleStage/buildNextAction.
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

/** Catalog keys for the doc-exact wording (Plan Dispatch v2.0 §11, English text in catalog/en.ts) for the stage a load is currently "at". Rows for
 *  loading_confirmed/at_plant/closed intentionally repeat their collapsed target's label — see
 *  utils/trip-view.ts's resolveLifecycleStage, the only place that does the collapsing. */
export const LIFECYCLE_STAGE_LABEL_KEYS: Record<LoadStatus | typeof PAYMENTS_STAGE, MessageKey> = {
  created: 'loads.stage.created',
  assigned: 'loads.stage.assigned',
  loading_confirmed: 'loads.stage.assigned',
  at_plant: 'loads.stage.assigned',
  in_transit: 'loads.stage.inTransit',
  reached_delivery_point: 'loads.stage.reachedDelivery',
  delivered: 'loads.stage.delivered',
  closed: 'loads.stage.delivered',
  payments: 'loads.stage.payments',
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
  'ISSUE_REPORTED',
  'POD_REVIEWED',
] as const;
export type LoadActivityAction = (typeof LOAD_ACTIVITY_ACTIONS)[number];

export const LOAD_PAYMENT_TYPES = ['advance', 'balance'] as const;
export type LoadPaymentType = (typeof LOAD_PAYMENT_TYPES)[number];

/** Driver-app "Report An Issue" categories — see load-issue.service.ts's reportIssue. No
 *  escalation workflow reads these yet (same "no exceptions/escalations module" gap as
 *  SEAL_STATUSES above); reports are recorded and visible to staff via GET /loads/:id/issues, not
 *  acted on automatically. */
export const LOAD_ISSUE_CATEGORIES = [
  'breakdown',
  'halt_rest_stop',
  'traffic_jam',
  'accident',
  'road_blocked',
  'police_rto_check',
  'other',
] as const;
export type LoadIssueCategory = (typeof LOAD_ISSUE_CATEGORIES)[number];

/** Categories that put the trip on hold until staff resolve the report — the driver can't move the
 *  load forward and the trip-detail view shows it as halted. Every other category is shown as
 *  incident info only. */
export const HALTING_ISSUE_CATEGORIES: readonly LoadIssueCategory[] = ['accident', 'breakdown'];
