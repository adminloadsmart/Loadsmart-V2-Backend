import {
  AwardParty,
  LoadPostingType,
  LoadRoute,
  LoadStatus,
  ShortageOrDamageStatus,
} from '../utils/loads.types';

/**
 * The Load module's state machine as one table, keyed by (route, from, trigger). Pure — no DB/IO,
 * unit-tested in stage-rules.test.ts. Domain services never name a target stage: they report what
 * happened (a trigger) and LoadStageService asks this table where that takes the load, so a stage
 * can't be skipped and a route can't take a step that isn't its own.
 *
 * Who may fire a trigger is checked twice: the route's requirePermission decides which people
 * reach the endpoint (docs/rbac.md), and `actors` here decides which kind of caller may take the
 * step at all (the driver app can't decide a POD; a shipper can't decide one on a Loadsmart load).
 */

export const STAGE_TRIGGERS = [
  'first_bid',
  'transporter_awarded',
  'loadsmart_awarded',
  'indent_accepted',
  'indent_rejected',
  'memo_accepted',
  'trip_started',
  'reached_loading',
  'papers_complete',
  'left_loading',
  'reached_unloading',
  'pod_clean',
  'pod_issue',
  'issue_resolved',
  'invoice_issued',
  'transporter_invoice_uploaded',
  'payment_recorded',
  'settled',
  'truck_cancelled_new_truck',
  'truck_cancelled_reopen',
] as const;
export type StageTrigger = (typeof STAGE_TRIGGERS)[number];

/** The kind of caller taking a step. `ls_team` is Loadsmart staff on the ops console; `system` is
 *  a move nobody made by hand (a tracking event, or closing once the last condition is met). */
export const STAGE_ACTOR_TYPES = ['shipper', 'driver', 'transporter', 'ls_team', 'system'] as const;
export type StageActorType = (typeof STAGE_ACTOR_TYPES)[number];

/** A load's route for the table: its route, or `unrouted` while a market load has no winner. */
export type RouteKey = LoadRoute | 'unrouted';
const ALL_ROUTES: readonly RouteKey[] = ['loadsmart', 'own_transporter', 'indent', 'own_fleet'];
const NOT_LOADSMART: readonly RouteKey[] = ['own_transporter', 'indent', 'own_fleet'];
const EXECUTION_ACTORS: readonly StageActorType[] = ['driver', 'shipper', 'ls_team', 'system'];
const TRUCK_CANCELLABLE: readonly LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
];

/** The load fields the rules read. Requirements see the load as it will be after the move: the
 *  caller's fields and the rule's own effect applied over the stored row. */
export interface StageRuleLoad {
  status: LoadStatus;
  postingType: LoadPostingType;
  route: LoadRoute | null;
  awardedParty: AwardParty | null;
  transporterId: string | null;
  vehicleNumber: string | null;
  memoAcceptedAt: Date | null;
  invoiceNumber: string | null;
  invoiceFileKey: string | null;
  ewayBillNumber: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
  lsPapersApprovedAt: Date | null;
  podFileKey: string | null;
  podStatus: string | null;
  shortageOrDamage: ShortageOrDamageStatus | null;
  deliveryIssueSettledAt: Date | null;
  transporterInvoiceFileKey: string | null;
  advancePaidAt: Date | null;
  balancePaidAt: Date | null;
  partnerBalancePaidAt: Date | null;
}

/** Fields a rule itself writes with the move (the route, whose award it is). */
export type StageEffect = Partial<Pick<StageRuleLoad, 'route' | 'awardedParty' | 'postingType'>>;

export interface StageRule {
  trigger: StageTrigger;
  from: readonly LoadStatus[];
  /** Where the load goes. Equal to `from` for a step that changes who has it, not the stage. */
  to: LoadStatus;
  routes: readonly RouteKey[];
  actors: readonly StageActorType[];
  /** What the load as it stands (before this move's fields and effect) must already be. */
  before?: (load: StageRuleLoad) => string[];
  /** What's missing for the move, as short labels; empty when nothing is. */
  requires?: (load: StageRuleLoad) => string[];
  effect?: (load: StageRuleLoad) => StageEffect;
}

const need = (...checks: [boolean, string][]) =>
  checks.filter(([ok]) => !ok).map(([, label]) => label);

/** "3 papers move it to Loaded": invoice, e-way bill and the signed LR. Weighing slip and truck
 *  photos are optional; the LR number isn't required — only the signed copy. */
export function missingLoadingPapers(load: StageRuleLoad): string[] {
  return need(
    [!!load.invoiceNumber, 'invoice number'],
    [!!load.invoiceFileKey, 'invoice'],
    [!!load.ewayBillNumber, 'e-way bill number'],
    [!!load.ewayBillFileKey, 'e-way bill'],
    [!!load.elrFileKey, 'signed LR'],
  );
}

const podDecided = (load: StageRuleLoad) =>
  need([!!load.podFileKey, 'POD'], [load.podStatus === 'accepted', 'POD accepted']);

export const STAGE_RULES: readonly StageRule[] = [
  // --- Sourcing -------------------------------------------------------------------------------
  {
    trigger: 'first_bid',
    from: ['created'],
    to: 'bids_received',
    routes: ['unrouted'],
    actors: ['transporter', 'shipper', 'ls_team', 'system'],
    requires: (load) => need([load.postingType === 'market_fleet', 'a market load']),
  },
  {
    // The shipper accepts a transporter's bid (or assigns one directly) — once per load. The
    // driver and checks follow before the memo.
    trigger: 'transporter_awarded',
    from: ['created', 'bids_received'],
    to: 'bids_received',
    routes: ['unrouted'],
    actors: ['shipper'],
    before: (load) => need([load.awardedParty === null, 'no bid accepted yet']),
    requires: (load) =>
      need(
        [load.postingType === 'market_fleet', 'a market load'],
        [!!load.transporterId, 'transporter'],
      ),
    effect: () => ({ route: 'own_transporter', awardedParty: 'transporter' }),
  },
  {
    // The shipper takes Loadsmart's price. The load becomes a Loadsmart load only when the
    // shipper accepts Loadsmart's memo (memo_accepted); until then it stays unrouted.
    trigger: 'loadsmart_awarded',
    from: ['bids_received'],
    to: 'bids_received',
    routes: ['unrouted'],
    actors: ['shipper'],
    before: (load) => need([load.awardedParty === null, 'no bid accepted yet']),
    requires: (load) => need([load.postingType === 'market_fleet', 'a market load']),
    effect: () => ({ awardedParty: 'loadsmart' }),
  },
  {
    trigger: 'indent_accepted',
    from: ['created'],
    to: 'bids_received',
    routes: ['unrouted'],
    // The transporter itself, or the shipper entering an acceptance given by phone.
    actors: ['transporter', 'shipper'],
    requires: (load) =>
      need([load.postingType === 'indent', 'an indent'], [!!load.transporterId, 'transporter']),
    effect: () => ({ route: 'indent', awardedParty: 'transporter' }),
  },
  {
    // The contracted transporter rejects the indent (or the shipper records a rejection given by
    // phone): the load goes to the open market, Loadsmart included — it stays at Created as a
    // market load. The contract's non-placement penalty is recorded with it.
    trigger: 'indent_rejected',
    from: ['created'],
    to: 'created',
    routes: ['unrouted'],
    actors: ['transporter', 'shipper'],
    before: (load) => need([load.postingType === 'indent', 'an indent']),
    effect: () => ({ postingType: 'market_fleet' }),
  },
  {
    // "Memo acceptance is the trigger into Truck assigned" — on every route but own fleet.
    trigger: 'memo_accepted',
    from: ['bids_received'],
    to: 'truck_assigned',
    // `loadsmart` too: after a truck cancellation the Loadsmart load waits on a new memo version.
    routes: ['own_transporter', 'indent', 'unrouted', 'loadsmart'],
    // Loadsmart staff record an acceptance the shipper gave on a call (Loadsmart loads only).
    actors: ['shipper', 'ls_team'],
    requires: (load) =>
      need(
        [load.route !== null, 'an awarded bid'],
        [!!load.memoAcceptedAt, 'accepted load memo'],
        [!!load.vehicleNumber, 'truck number'],
      ),
    effect: (load) =>
      load.route === null && load.awardedParty === 'loadsmart' ? { route: 'loadsmart' } : {},
  },

  // --- Truck cancelled before loading ------------------------------------------------------------
  // "A load goes back only when its truck is cancelled after Truck assigned and before Loaded."
  // The shipper marks it on their own transporter's and indent loads; on a Loadsmart load,
  // Placement does. Either the same transporter sends another truck — back to Bids received with
  // the award kept, for new details, checks and a new memo version — or the load goes back to
  // Created with no winner.
  {
    trigger: 'truck_cancelled_new_truck',
    from: TRUCK_CANCELLABLE,
    to: 'bids_received',
    routes: ['own_transporter', 'indent'],
    actors: ['shipper'],
  },
  {
    trigger: 'truck_cancelled_new_truck',
    from: TRUCK_CANCELLABLE,
    to: 'bids_received',
    routes: ['loadsmart'],
    actors: ['ls_team'],
  },
  {
    trigger: 'truck_cancelled_reopen',
    from: TRUCK_CANCELLABLE,
    to: 'created',
    routes: ['own_transporter', 'indent'],
    actors: ['shipper'],
    effect: () => ({ route: null, awardedParty: null }),
  },
  {
    trigger: 'truck_cancelled_reopen',
    from: TRUCK_CANCELLABLE,
    to: 'created',
    routes: ['loadsmart'],
    actors: ['ls_team'],
    effect: () => ({ route: null, awardedParty: null }),
  },

  // --- Execution ------------------------------------------------------------------------------
  {
    trigger: 'trip_started',
    from: ['truck_assigned'],
    to: 'in_transit_loading',
    routes: ALL_ROUTES,
    actors: EXECUTION_ACTORS,
  },
  {
    trigger: 'reached_loading',
    from: ['in_transit_loading'],
    to: 'reached_loading',
    routes: ALL_ROUTES,
    actors: EXECUTION_ACTORS,
  },
  {
    trigger: 'papers_complete',
    from: ['reached_loading'],
    to: 'loaded',
    routes: NOT_LOADSMART,
    actors: EXECUTION_ACTORS,
    requires: missingLoadingPapers,
  },
  {
    // "Truck waits for approval": on a Loadsmart load Loadsmart's Tracking team approves the
    // invoice, e-way bill and signed LR in the documents register; the last approval moves it.
    trigger: 'papers_complete',
    from: ['reached_loading'],
    to: 'loaded',
    routes: ['loadsmart'],
    actors: ['ls_team'],
    requires: (load) => [
      ...missingLoadingPapers(load),
      ...need([!!load.lsPapersApprovedAt, 'papers approved']),
    ],
  },
  {
    trigger: 'left_loading',
    from: ['loaded'],
    to: 'in_transit_unloading',
    routes: ALL_ROUTES,
    actors: EXECUTION_ACTORS,
  },
  {
    trigger: 'reached_unloading',
    from: ['in_transit_unloading'],
    to: 'reached_unloading',
    routes: ALL_ROUTES,
    actors: EXECUTION_ACTORS,
  },

  // --- Delivery: the shipper decides the POD; on a Loadsmart load, Loadsmart's Tracking team ----
  {
    trigger: 'pod_clean',
    from: ['reached_unloading'],
    to: 'delivered_ok',
    routes: NOT_LOADSMART,
    actors: ['shipper'],
    requires: podDecided,
  },
  {
    trigger: 'pod_clean',
    from: ['reached_unloading'],
    to: 'delivered_ok',
    routes: ['loadsmart'],
    actors: ['ls_team'],
    requires: podDecided,
  },
  {
    trigger: 'pod_issue',
    from: ['reached_unloading'],
    to: 'delivered_with_issues',
    routes: NOT_LOADSMART,
    actors: ['shipper'],
    requires: (load) => [
      ...podDecided(load),
      ...need([!!load.shortageOrDamage && load.shortageOrDamage !== 'none', 'the issue']),
    ],
  },
  {
    trigger: 'pod_issue',
    from: ['reached_unloading'],
    to: 'delivered_with_issues',
    routes: ['loadsmart'],
    actors: ['ls_team'],
    requires: (load) => [
      ...podDecided(load),
      ...need([!!load.shortageOrDamage && load.shortageOrDamage !== 'none', 'the issue']),
    ],
  },
  {
    // Own fleet / own transporter / indent: the shipper records how it was handled. Loadsmart:
    // settled through its claim (the shipper settles it today; Phase 8 moves it to CS).
    trigger: 'issue_resolved',
    from: ['delivered_with_issues'],
    to: 'delivered_ok',
    routes: ALL_ROUTES,
    actors: ['shipper', 'ls_team'],
    requires: (load) => need([!!load.deliveryIssueSettledAt, 'how the issue was resolved']),
  },

  // --- Money ----------------------------------------------------------------------------------
  {
    // Loadsmart's invoice, issued by Receivables. "Billing never waits for an issue": it can go
    // out while CS works the claim, which then comes off as a credit note.
    trigger: 'invoice_issued',
    from: ['delivered_ok', 'delivered_with_issues'],
    to: 'invoice_generated',
    routes: ['loadsmart'],
    actors: ['ls_team'],
    requires: podDecided,
  },
  {
    trigger: 'transporter_invoice_uploaded',
    from: ['delivered_ok'],
    to: 'invoice_generated',
    routes: ['own_transporter', 'indent'],
    actors: ['shipper'],
    requires: (load) => need([!!load.transporterInvoiceFileKey, "transporter's invoice"]),
  },
  {
    trigger: 'payment_recorded',
    from: ['invoice_generated'],
    to: 'payment',
    routes: ['own_transporter', 'indent'],
    actors: ['shipper'],
    requires: (load) => need([!!load.balancePaidAt, 'balance payment']),
  },
  {
    // Loadsmart load: "payments are being collected and made" — the shipper reports a payment, or
    // Receivables records a receipt.
    trigger: 'payment_recorded',
    from: ['invoice_generated'],
    to: 'payment',
    routes: ['loadsmart'],
    actors: ['shipper', 'ls_team'],
  },
  {
    // Closes once nothing is owed either way. Own fleet closes from Delivered.
    trigger: 'settled',
    from: ['delivered_ok'],
    to: 'closed',
    routes: ['own_fleet'],
    actors: ['shipper', 'ls_team', 'system'],
    requires: podDecided,
  },
  {
    trigger: 'settled',
    from: ['payment'],
    to: 'closed',
    routes: ['own_transporter', 'indent'],
    actors: ['shipper', 'ls_team', 'system'],
    requires: (load) =>
      need([!!load.advancePaidAt, 'advance payment'], [!!load.balancePaidAt, 'balance payment']),
  },
  {
    trigger: 'settled',
    from: ['payment'],
    to: 'closed',
    routes: ['loadsmart'],
    actors: ['shipper', 'ls_team', 'system'],
    requires: (load) =>
      need(
        [!!load.balancePaidAt, "shipper's payment"],
        [!!load.partnerBalancePaidAt, "carrier's balance"],
        [
          !load.shortageOrDamage ||
            load.shortageOrDamage === 'none' ||
            !!load.deliveryIssueSettledAt,
          'the claim closed',
        ],
      ),
  },
];

export const STAGE_ERROR_CODES = {
  notAllowed: 'STAGE_TRIGGER_NOT_ALLOWED',
  missing: 'STAGE_REQUIREMENT_MISSING',
} as const;

export type StageDecision =
  | { ok: true; rule: StageRule; to: LoadStatus; effect: StageEffect }
  | {
      ok: false;
      code: (typeof STAGE_ERROR_CODES)[keyof typeof STAGE_ERROR_CODES];
      message: string;
      missing: string[];
    };

export const routeKeyOf = (load: { route: LoadRoute | null }): RouteKey => load.route ?? 'unrouted';

const label = (value: string) => value.replace(/_/g, ' ');

/** Where `trigger` takes this load when `actor` fires it, or why it can't. `fields` are the
 *  columns the caller writes with the move — requirements read them. */
export function decideStage(
  load: StageRuleLoad,
  trigger: StageTrigger,
  actor: StageActorType,
  fields: Partial<StageRuleLoad> = {},
): StageDecision {
  const notAllowed = (message: string): StageDecision => ({
    ok: false,
    code: STAGE_ERROR_CODES.notAllowed,
    message,
    missing: [],
  });
  const route = routeKeyOf(load);
  const forTrigger = STAGE_RULES.filter((rule) => rule.trigger === trigger);
  const forRoute = forTrigger.filter((rule) => rule.routes.includes(route));
  if (!forRoute.length) {
    return notAllowed(
      route === 'unrouted'
        ? `A load with no winner yet can't take "${label(trigger)}"`
        : `A ${label(route)} load never takes "${label(trigger)}"`,
    );
  }
  const forStage = forRoute.filter((rule) => rule.from.includes(load.status));
  if (!forStage.length) {
    const from = [...new Set(forRoute.flatMap((rule) => rule.from))].map(label).join(' or ');
    return notAllowed(`"${label(trigger)}" happens from ${from}, not ${label(load.status)}`);
  }
  const rule = forStage.find((candidate) => candidate.actors.includes(actor));
  if (!rule) {
    const who = [...new Set(forStage.flatMap((candidate) => candidate.actors))]
      .map(label)
      .join(' or ');
    return notAllowed(
      `On this load, "${label(trigger)}" is for the ${who}, not the ${label(actor)}`,
    );
  }

  const withFields = { ...load, ...fields };
  const effect = rule.effect?.(withFields) ?? {};
  const missing = [
    ...(rule.before?.(load) ?? []),
    ...(rule.requires?.({ ...withFields, ...effect }) ?? []),
  ];
  if (missing.length) {
    return {
      ok: false,
      code: STAGE_ERROR_CODES.missing,
      message: `Can't take "${label(trigger)}" yet — missing: ${missing.join(', ')}`,
      missing,
    };
  }
  return { ok: true, rule, to: rule.to, effect };
}
