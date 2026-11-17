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

/** How the shipper posted the load — fixed at posting, except that a rejected indent goes to the
 *  open market (indent → market_fleet, recorded on the load's activity). Analytics and the
 *  indent penalty read this; the stage rules read `route`. */
export const LOAD_POSTING_TYPES = ['market_fleet', 'indent', 'own_fleet'] as const;
export type LoadPostingType = (typeof LOAD_POSTING_TYPES)[number];

/** Who carries the load, known once someone has won it:
 *  - `own_fleet` — the shipper's own truck; set at posting.
 *  - `indent` — the contracted transporter; set when it accepts the indent.
 *  - `own_transporter` — one of the shipper's transporters; set when the shipper awards its bid.
 *  - `loadsmart` — Loadsmart sources, runs, invoices and pays; set when the shipper accepts
 *    Loadsmart's load memo.
 *  Null while a market load has no winner (stages 1–2 only — a DB CHECK enforces it). */
export const LOAD_ROUTES = ['loadsmart', 'own_transporter', 'indent', 'own_fleet'] as const;
export type LoadRoute = (typeof LOAD_ROUTES)[number];

/** Whose bid the shipper awarded on a market load. A Loadsmart award only becomes the load's
 *  route when its memo is accepted; until then the load is unrouted with a Loadsmart award. */
export const AWARD_PARTIES = ['transporter', 'loadsmart'] as const;
export type AwardParty = (typeof AWARD_PARTIES)[number];

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

/** The POD decision's trigger: anything other than 'none' puts the load in Delivered with issues
 *  until it is resolved (LoadService.settleDeliveryIssue). */
export function podDecisionTrigger(
  shortageOrDamage: ShortageOrDamageStatus | null | undefined,
): 'pod_clean' | 'pod_issue' {
  return shortageOrDamage && shortageOrDamage !== 'none' ? 'pod_issue' : 'pod_clean';
}

/** Manual stage marks (no tracking) as the trigger each one is. */
export const MANUAL_MARK_TRIGGERS = {
  in_transit_loading: 'trip_started',
  reached_loading: 'reached_loading',
  in_transit_unloading: 'left_loading',
  reached_unloading: 'reached_unloading',
} as const;

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
 * The load's single movement status — the spec's 13 stages. Every route goes through all of them
 * except own fleet, which starts at Truck assigned and closes from Delivered (no 1, 2, 11, 12).
 * The original POD is not a stage: Payables tracks it beside the load (originalPodReceivedAt).
 *
 * Order is the spec's stage order, but moves are NOT walked by index — the two delivered stages
 * are a branch. core/stage-rules.ts's trigger table is the only source of which move is allowed,
 * and LoadStageService the only writer.
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
  'delivered_ok', // 9 · Delivery — no issue on the POD, or the issue was resolved
  'delivered_with_issues', // 10 · Delivery — damage, shortage or pilferage, not yet resolved
  'invoice_generated', // 11 · Money — Loadsmart's invoice issued / the transporter's uploaded
  'payment', // 12 · Money — the shipper's payment recorded, with proof
  'closed', // 13
  // Outside the 13: the shipper cancelled the load before it was Loaded (a Loadsmart load once
  // Super Admin approves). Nothing moves it on.
  'cancelled',
] as const;

/** Stages 11–12 — every route but own fleet. */
export const MONEY_LOAD_STATUSES: readonly LoadStatus[] = ['invoice_generated', 'payment'];
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

/** The stages each route goes through. Own fleet starts at Truck assigned (its truck and driver
 *  are picked when posting) and closes from Delivered — nothing to invoice or pay. */
export const OWN_FLEET_STAGES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) =>
    status !== 'created' &&
    status !== 'bids_received' &&
    status !== 'cancelled' &&
    !MONEY_LOAD_STATUSES.includes(status),
);
/** The 13 stages a load goes through — every status but Cancelled. */
export const LIFECYCLE_STAGES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) => status !== 'cancelled',
);

/** Trips Home-page tab boundary — a delivered load is deliberately NOT completed: it only counts
 *  as done once staff has accepted its E-POD, any delivery issue is settled (and, for market
 *  loads, both advance and balance are paid) and LoadService.closeLoad has flipped it to 'closed'. */
export const COMPLETED_LOAD_STATUSES: readonly LoadStatus[] = ['closed'];
/** "A place for cancelled loads to go" — their own tab, never Active, Open or Completed. */
export const CANCELLED_LOAD_STATUSES: readonly LoadStatus[] = ['cancelled'];
export const ACTIVE_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.filter(
  (status) =>
    !COMPLETED_LOAD_STATUSES.includes(status) && !CANCELLED_LOAD_STATUSES.includes(status),
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
  (status) => status !== 'closed' && status !== 'cancelled',
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
/** A truck is assigned but not yet loaded — the loading contact and loading point still matter
 *  (the driver app's "Loading contact/point changed" cards stay actionable). */
export const PRE_LOADED_LOAD_STATUSES: readonly LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
];
/** The truck is at or past the delivery point — trip-execution alerts (LS_N_0025/0026) no longer
 *  apply. */
export const ARRIVED_AT_DELIVERY_STATUSES: readonly LoadStatus[] = [
  'reached_unloading',
  ...UNLOADED_LOAD_STATUSES,
  'closed',
  'cancelled',
];

/** Upper bound on the optional cargo value per MT a requisition / posting can carry (LS_N_0034). */
export const MAX_CARGO_VALUE_PER_TONNE = 10_000_000;
/** Upper bound on a driver issue report's expected delay — 7 days, in minutes (LS_N_0037). */
export const MAX_ISSUE_ETA_IMPACT_MINUTES = 7 * 24 * 60;
export const LOAD_STATUS_GROUPS = ['active', 'completed', 'open', 'upcoming', 'cancelled'] as const;
export type LoadStatusGroup = (typeof LOAD_STATUS_GROUPS)[number];
export const LOAD_STATUS_GROUP_FILTERS: Record<LoadStatusGroup, readonly LoadStatus[]> = {
  active: ACTIVE_TAB_LOAD_STATUSES,
  completed: COMPLETED_LOAD_STATUSES,
  open: OPEN_LOAD_STATUSES,
  upcoming: UPCOMING_LOAD_STATUSES,
  cancelled: CANCELLED_LOAD_STATUSES,
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
  'DOCUMENT_REVIEWED',
  'CHARGE_ADDED',
  'TRUCK_CANCELLED',
  'BID_COUNTERED',
  'BID_COUNTER_ANSWERED',
  'BID_REJECTED',
  'LOAD_CANCELLED',
  'LOAD_CANCEL_REQUESTED',
  'LOAD_CANCEL_REJECTED',
  'LOAD_EDITED',
  'PAYMENT_RECORDED',
  'ISSUE_REPORTED',
  'POD_REVIEWED',
  'DELIVERY_ISSUE_SETTLED',
  'BID_RECORDED',
  'BID_ACCEPTED',
  'TRANSPORTER_INVOICE_UPLOADED',
  'DRIVER_NAMED',
  'MEMO_SENT',
  'MEMO_ACCEPTED',
  'MEMO_WITHDRAWN',
  'CHECKS_RERUN',
  'INDENT_REJECTED',
  'LOADSMART_STEP',
  'LOADING_CONTACT_CHANGED',
  'UNLOADING_DETAILS_SAVED',
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
  'flat_tyre',
  'no_entry',
  'feeling_unwell',
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

/** The shipper's counter-offer on a live bid: `pending` until the bidder answers (by phone for a
 *  transporter, recorded by the shipper; on the console for Loadsmart's own bid). */
export const BID_COUNTER_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type BidCounterStatus = (typeof BID_COUNTER_STATUSES)[number];

/** One step in a bid's rate history — every rate it has carried stays on the bid. */
export interface BidRateStep {
  at: string;
  by: string | null;
  kind: 'bid' | 'revised' | 'counter' | 'counter_accepted' | 'counter_declined';
  rate: string;
}

/** How the bid reached Loadsmart — `web` is the shipper typing in a rate given by phone (and,
 *  for indent, the transporter's acceptance); `whatsapp` arrives with the WhatsApp buttons. */
export const BID_CHANNELS = ['web', 'whatsapp'] as const;

/** Who the bid is from — one of the shipper's own transporters, or Loadsmart (its placement team
 *  sends one best partner bid, priced with its margin, without the partner's name). */
export const BID_SOURCES = ['transporter', 'loadsmart'] as const;
export type BidSource = (typeof BID_SOURCES)[number];
export type BidChannel = (typeof BID_CHANNELS)[number];

/** The load memo the shipper accepts before the trip starts (loads/memo/). */
/** `superseded`: a newer version went out before this one was accepted (a changed truck or
 *  driver, or a resend). */
export const MEMO_STATUSES = ['sent', 'accepted', 'expired', 'superseded', 'withdrawn'] as const;
export type MemoStatus = (typeof MEMO_STATUSES)[number];

/** How the memo was accepted: by the shipper in the app, or confirmed by Loadsmart's Placement
 *  team after a call (Loadsmart loads only). */
export const MEMO_ACCEPT_CHANNELS = ['app', 'call'] as const;
export type MemoAcceptChannel = (typeof MEMO_ACCEPT_CHANNELS)[number];

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
  'requisition' | 'load' | 'customer' | 'transporter' | 'lr' | 'ls_invoice' | 'ls_credit_note';
