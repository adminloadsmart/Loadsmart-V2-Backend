/**
 * Load module value sets — each declared once as a `const` tuple, same pattern as
 * masters/vehicle/vehicle.type.ts, so the entity's `@Column({ enum: [...] })`, validators and
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

/** `indent` — posted straight to one contracted transporter at the contract rate (Post a load).
 *  `loadsmart` — a market load whose Loadsmart bid the shipper accepted: Loadsmart sources the
 *  truck from its partners, runs the trip, invoices the shipper and pays the partner. */
export const LOAD_SOURCE_TYPES = ['own_fleet', 'market', 'indent', 'loadsmart'] as const;
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
export const SHORTAGE_OR_DAMAGE_STATUSES = [
  'none',
  'shortage',
  'damage',
  'wet',
  'both',
  'pilferage',
] as const;
export type ShortageOrDamageStatus = (typeof SHORTAGE_OR_DAMAGE_STATUSES)[number];

/** Anything other than 'none' noted on the POD puts the load in Delivered with issues until it is
 *  settled (LoadService.settleDeliveryIssue). */
export function deliveredStageFor(
  shortageOrDamage: ShortageOrDamageStatus | null | undefined,
): 'delivered_ok' | 'delivered_with_issues' {
  return shortageOrDamage && shortageOrDamage !== 'none' ? 'delivered_with_issues' : 'delivered_ok';
}

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
 * The load's single, unified movement status — the client's 13-stage lifecycle ("Load flow ·
 * posting to payment"). Stages 1–10 live here; 11–13 (original POD received, invoice generated,
 * payment) only apply to Loadsmart loads and arrive with that route. Advance/balance payment are
 * tracked separately (LoadEntity.advancePaidAt/balancePaidAt) since they run in parallel with
 * movement rather than block it; see loads/entities/load.entity.ts's doc comment.
 *
 * Order is the design's stage order, but transitions are NOT walked by index — the two delivered
 * stages are a branch, not a sequence. LOAD_STAGE_TRANSITIONS below is the only source of which
 * move is allowed, and LoadStageService the only writer.
 */
export const LOAD_STATUSES = [
  'created', // 1 · Sourcing
  'bids_received', // 2 · Sourcing
  'truck_assigned', // 3 · Sourcing
  'in_transit_loading', // 4 · Execution
  'reached_loading', // 5 · Execution
  'loaded', // 6 · Execution
  'in_transit_unloading', // 7 · Execution
  'reached_unloading', // 8 · Execution
  'delivered_ok', // 9 · Delivery — nothing noted on the POD, or the issue was settled
  'delivered_with_issues', // 10 · Delivery — damage, shortage or pilferage noted, not yet settled
  'original_pod_received', // 11 · Money — Loadsmart only
  'invoice_generated', // 12 · Money — Loadsmart only
  'payment', // 13 · Money — Loadsmart only: the shipper's payment is in, awaiting verification
  'closed',
] as const;

/** Stages 11–13 — only a Loadsmart load goes through them. */
export const MONEY_LOAD_STATUSES: readonly LoadStatus[] = [
  'original_pod_received',
  'invoice_generated',
  'payment',
];
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/** Either delivered stage — the truck has unloaded and an E-POD is on record. */
export const DELIVERED_LOAD_STATUSES: readonly LoadStatus[] = [
  'delivered_ok',
  'delivered_with_issues',
];

/** The truck has unloaded — a delivered stage or one of the money stages after it. */
export const UNLOADED_LOAD_STATUSES: readonly LoadStatus[] = [
  ...DELIVERED_LOAD_STATUSES,
  ...MONEY_LOAD_STATUSES,
];

/** Every allowed single move. `delivered_ok -> delivered_with_issues` is only reachable through an
 *  E-POD resubmission that now notes an issue; `delivered_with_issues -> delivered_ok` is the
 *  settlement. 'closed' is terminal. */
export const LOAD_STAGE_TRANSITIONS: Record<LoadStatus, readonly LoadStatus[]> = {
  created: ['bids_received', 'truck_assigned'],
  bids_received: ['truck_assigned'],
  truck_assigned: ['in_transit_loading'],
  in_transit_loading: ['reached_loading'],
  reached_loading: ['loaded'],
  loaded: ['in_transit_unloading'],
  in_transit_unloading: ['reached_unloading'],
  reached_unloading: ['delivered_ok', 'delivered_with_issues'],
  delivered_ok: ['delivered_with_issues', 'original_pod_received', 'closed'],
  delivered_with_issues: ['delivered_ok'],
  original_pod_received: ['invoice_generated'],
  invoice_generated: ['payment'],
  payment: ['closed'],
  closed: [],
};

/** Which stages each route goes through. Own fleet starts at Truck assigned — no bids, the
 *  shipper's own truck and driver are picked when posting. */
const WITHOUT_MONEY_STAGES = LOAD_STATUSES.filter(
  (status) => !MONEY_LOAD_STATUSES.includes(status),
);
export const ROUTE_STAGES: Record<LoadSourceType, readonly LoadStatus[]> = {
  own_fleet: WITHOUT_MONEY_STAGES.filter(
    (status) => status !== 'created' && status !== 'bids_received',
  ),
  market: WITHOUT_MONEY_STAGES,
  indent: WITHOUT_MONEY_STAGES,
  loadsmart: LOAD_STATUSES,
};

/** Trips Home-page tab boundary — a delivered load is deliberately NOT completed: it only counts
 *  as done once staff has accepted its E-POD, any delivery issue is settled (and, for market
 *  loads, both advance and balance are paid) and LoadService.closeLoad has flipped it to 'closed'. */
export const COMPLETED_LOAD_STATUSES: readonly LoadStatus[] = ['closed'];
export const ACTIVE_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => !COMPLETED_LOAD_STATUSES.includes(status),
);
/** Trips "Active" tab — the trip is still being executed. Once the truck has unloaded (either
 *  delivered stage, or a money stage after it) the trip moves to Open, where it stays until its
 *  E-POD is accepted and the load is closed. */
export const ACTIVE_TAB_LOAD_STATUSES: readonly LoadStatus[] = ACTIVE_LOAD_STATUSES.filter(
  (status) => !UNLOADED_LOAD_STATUSES.includes(status),
);
/** Driver-app "Open Trips" tab — every status except 'closed'. Named separately from
 *  ACTIVE_LOAD_STATUSES (equal today) since they serve different audiences and may diverge. */
export const OPEN_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => status !== 'closed',
);
/** Driver-app "Upcoming" tab — not yet moving. */
export const UPCOMING_LOAD_STATUSES: readonly LoadStatus[] = [
  'created',
  'bids_received',
  'truck_assigned',
];
/** A truck on a load in one of these stages is on a live trip (C-02/C-07): assigned and not yet
 *  unloaded. */
export const ON_ROAD_LOAD_STATUSES: readonly LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
];
/** The truck is at or past the delivery point — trip-execution alerts (LS_N_0025/0026) no longer
 *  apply. */
export const ARRIVED_AT_DELIVERY_STATUSES: readonly LoadStatus[] = [
  'reached_unloading',
  ...UNLOADED_LOAD_STATUSES,
  'closed',
];

/** Upper bound on the optional cargo value per MT a requisition / posting can carry (LS_N_0034). */
export const MAX_CARGO_VALUE_PER_TONNE = 10_000_000;
/** Upper bound on a driver issue report's expected delay — 7 days, in minutes (LS_N_0037). */
export const MAX_ISSUE_ETA_IMPACT_MINUTES = 7 * 24 * 60;
export const LOAD_STATUS_GROUPS = ['active', 'completed', 'open', 'upcoming'] as const;
export type LoadStatusGroup = (typeof LOAD_STATUS_GROUPS)[number];
export const LOAD_STATUS_GROUP_FILTERS: Record<LoadStatusGroup, readonly LoadStatus[]> = {
  active: ACTIVE_TAB_LOAD_STATUSES,
  completed: COMPLETED_LOAD_STATUSES,
  open: OPEN_LOAD_STATUSES,
  upcoming: UPCOMING_LOAD_STATUSES,
};

/** Stages set by hand through PATCH /loads/:id/status (staff) or the driver app — there is no
 *  live tracking yet, so every movement stage is a manual mark. Loaded is reached only through
 *  the three loading papers, and the delivered stages only through the E-POD. */
export const MANUAL_TRACKING_STATUSES = [
  'in_transit_loading',
  'reached_loading',
  'in_transit_unloading',
  'reached_unloading',
] as const;
export type ManualTrackingStatus = (typeof MANUAL_TRACKING_STATUSES)[number];

export const LOAD_ACTIVITY_ACTIONS = [
  'LOAD_CREATED',
  'STATUS_CHANGED',
  'DOCUMENT_UPLOADED',
  'PAYMENT_RECORDED',
  'ISSUE_REPORTED',
  'POD_REVIEWED',
  'DELIVERY_ISSUE_SETTLED',
  'BID_RECORDED',
  'BID_ACCEPTED',
  'DRIVER_NAMED',
  'MEMO_SENT',
  'MEMO_ACCEPTED',
  'LOADSMART_STEP',
  'LOADING_CONTACT_CHANGED',
  'LOADING_POINT_CHANGED',
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
  'strike',
  'weather',
  'other',
] as const;
export type LoadIssueCategory = (typeof LOAD_ISSUE_CATEGORIES)[number];

/** Categories that put the trip on hold until staff resolve the report — the driver can't move the
 *  load forward and the trip-detail view shows it as halted. Every other category is shown as
 *  incident info only. */
export const HALTING_ISSUE_CATEGORIES: readonly LoadIssueCategory[] = ['accident', 'breakdown'];

/** What an assignment-time compliance check (LS_N_0017) found expired: the vehicle's papers or the
 *  driver's licence. */
export const ASSIGNMENT_COMPLIANCE_SUBJECTS = ['vehicle', 'driver'] as const;
export type AssignmentComplianceSubject = (typeof ASSIGNMENT_COMPLIANCE_SUBJECTS)[number];

/** The `docType` an expired driver licence is reported as (vehicle papers use the masters'
 *  DOCUMENT_TYPE_LABELS). */
export const DRIVING_LICENCE_DOC_LABEL = 'Driving licence';

/** A transporter's quote on one load (loads/bids/). `received` is the only live state; one bid is
 *  `accepted`, the rest of that load's live bids are `rejected` at that moment, and a live bid
 *  past its window reads (and is saved) as `expired`. */
export const BID_STATUSES = ['received', 'accepted', 'rejected', 'expired'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

/** How the bid reached Loadsmart — `web` is the shipper typing in a rate given by phone (and,
 *  for indent, the transporter's acceptance); `whatsapp` arrives with the WhatsApp buttons. */
export const BID_CHANNELS = ['web', 'whatsapp'] as const;

/** Who the bid is from — one of the shipper's own transporters, or Loadsmart (its placement team
 *  sends one best partner bid, priced with its margin, without the partner's name). */
export const BID_SOURCES = ['transporter', 'loadsmart'] as const;
export type BidSource = (typeof BID_SOURCES)[number];
export type BidChannel = (typeof BID_CHANNELS)[number];

/** The load memo the shipper accepts before the trip starts (loads/memo/). */
export const MEMO_STATUSES = ['sent', 'accepted', 'expired'] as const;
export type MemoStatus = (typeof MEMO_STATUSES)[number];

/** What a load-time govt-portal check looked at (loads/verification/). */
export const VERIFICATION_SUBJECTS = ['truck', 'driver'] as const;
export type VerificationSubject = (typeof VERIFICATION_SUBJECTS)[number];

/** `unavailable` — the portal couldn't be reached or isn't configured; never blocks. */
export const VERIFICATION_STATUSES = ['passed', 'failed', 'unavailable'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** How the load's truck is tracked — the client's chain GPS device → driver's mobile (app) → SIM
 *  → FASTag. Saved on the load (LoadEntity.trackingSource) for the tracking service to read and
 *  update; see utils/tracking-source.ts for the starting value. */
export const TRACKING_SOURCES = ['gps', 'driver_app', 'sim', 'fastag'] as const;
export type TrackingSource = (typeof TRACKING_SOURCES)[number];

export type CodeSequenceEntityKind =
  'requisition' | 'load' | 'customer' | 'transporter' | 'lr' | 'ls_invoice';
