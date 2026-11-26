import type { WhatsappOnlyBrokerResponse } from './loadsmart.types';
/**
 * Placement's work queue and load page (Figma "Placement Work Queue"): the tabs a load shows
 * under, its memo state, the pricing guidance and the requirement sent to brokers. Pure.
 */

/** What a broker said when Placement logged a response. */
export const BROKER_RESPONSES = ['bid', 'declined', 'no_truck', 'call_back_later'] as const;
/** Any response in a broker's history: one Placement logs, or a WhatsApp-only answer. */
export type BrokerResponse = (typeof BROKER_RESPONSES)[number] | WhatsappOnlyBrokerResponse;

/** How the response came in. */
export const BROKER_RESPONSE_CHANNELS = ['manual_entry', 'phone', 'whatsapp', 'email'] as const;
export type BrokerResponseChannel = (typeof BROKER_RESPONSE_CHANNELS)[number];

/** The queue's tabs. A load can show under several (e.g. "With bids" and "Pickup today"). */
export const PLACEMENT_TABS = [
  'all',
  'without_bids',
  'with_bids',
  'placed',
  'mine',
  'pickup_today',
  'memo_sent',
  'memo_confirmed',
] as const;
export type PlacementTab = (typeof PLACEMENT_TABS)[number];

export const MEMO_STATES = ['not_sent', 'sent', 'expired', 'accepted'] as const;
export type MemoState = (typeof MEMO_STATES)[number];

/** Extra hours Placement may add to a bid window at a time. */
export const MAX_BID_WINDOW_EXTENSION_HOURS = 24;

export interface PlacementRowFacts {
  /** A partner's truck is on the load (Loadsmart won and the truck is named). */
  placed: boolean;
  activeBids: number;
  ownerId: string | null;
  /** The posting's reporting time, ISO. */
  reportingAt: string | null;
  memo: MemoState;
}

/** The tabs a load belongs to. `todayStart`/`todayEnd` bound the IST day. */
export function placementTabs(
  facts: PlacementRowFacts,
  actorId: string,
  todayStart: string,
  todayEnd: string,
): PlacementTab[] {
  const tabs: PlacementTab[] = ['all'];
  if (facts.placed) tabs.push('placed');
  else tabs.push(facts.activeBids > 0 ? 'with_bids' : 'without_bids');
  if (facts.ownerId === actorId) tabs.push('mine');
  if (facts.reportingAt && facts.reportingAt >= todayStart && facts.reportingAt < todayEnd) {
    tabs.push('pickup_today');
  }
  if (facts.memo === 'sent') tabs.push('memo_sent');
  if (facts.memo === 'accepted') tabs.push('memo_confirmed');
  return tabs;
}

/** The latest memo's state as the queue shows it. */
export function memoState(
  memoAcceptedAt: Date | null,
  latest: { status: string; expiresAt: Date } | null,
  now: Date,
): MemoState {
  if (memoAcceptedAt) return 'accepted';
  if (!latest) return 'not_sent';
  if (latest.status === 'accepted') return 'accepted';
  if (latest.status === 'sent' && latest.expiresAt > now) return 'sent';
  return latest.status === 'sent' || latest.status === 'expired' ? 'expired' : 'not_sent';
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The middle of recent carrier rates on the lane — the "market rate". Null with none. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/** The highest carrier rate that still leaves the margin floor on the shipper's price. */
export function rateCeiling(shipperPrice: number, marginFloorPercent: number): number {
  return round2(shipperPrice * (1 - marginFloorPercent / 100));
}

export interface RequirementFacts {
  loadCode: string;
  from: string | null;
  to: string | null;
  reportingAt: Date | null;
  truck: string | null;
  goods: string | null;
  tonnes: number | null;
}

/** The requirement message brokers get on WhatsApp — no shipper name, no price. */
export function requirementMessage(facts: RequirementFacts): string {
  const reporting = facts.reportingAt
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      }).format(facts.reportingAt)
    : null;
  return [
    `Loadsmart load ${facts.loadCode}`,
    `${facts.from ?? '—'} → ${facts.to ?? '—'}`,
    reporting ? `Reporting: ${reporting}` : null,
    facts.truck ? `Truck: ${facts.truck}` : null,
    [facts.goods, facts.tonnes ? `${facts.tonnes} MT` : null].filter(Boolean).join(' · ') || null,
    'Reply with your rate and truck number.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** wa.me link for an Indian mobile (10 digits, or with 91 in front). */
export function whatsappLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const number = digits.length === 10 ? `91${digits}` : digits.length === 12 ? digits : null;
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

/** Why brokers can't be added to a load's list any more, or null while they still can. Placement
 *  owns a load from Created to Truck assigned, so the list is open only while the load is on the
 *  board (posted, or its bid sent to the shipper) — the same rule as Send Requirement. */
export function brokersClosedReason(sourcingStatus: string): string | null {
  return sourcingStatus === 'posted' || sourcingStatus === 'bid_sent'
    ? null
    : "This load is no longer open for sourcing — brokers can't be added";
}

/** A failed WhatsApp send in Placement's words: a short `label` for the pill and a `hint` that
 *  says what to do. The raw `failReason` stays on the response for the tech team. */
export interface WhatsappFailure {
  label: string;
  hint: string;
}

/** Meta / WhatsApp Cloud API error codes seen on broker sends. */
const WHATSAPP_ERROR_CODES: Record<string, WhatsappFailure> = {
  '131049': {
    label: 'Held back by WhatsApp',
    hint: 'WhatsApp limits business messages to this number for now — call them',
  },
  '131026': {
    label: 'Not delivered',
    hint: "Number can't get WhatsApp messages — check it or call them",
  },
  '131047': {
    label: 'Not delivered',
    hint: 'No reply from them in 24 h, so WhatsApp blocked the message — call them',
  },
  '131050': {
    label: 'Opted out',
    hint: 'They have stopped business messages on WhatsApp — call them',
  },
  '131048': {
    label: 'Held back by WhatsApp',
    hint: 'WhatsApp spam limit reached — try later or call them',
  },
  '131056': {
    label: 'Too many messages',
    hint: 'Too many messages to this number just now — try again later',
  },
  '130472': {
    label: 'Held back by WhatsApp',
    hint: 'WhatsApp is not delivering to this number right now — call them',
  },
  '131042': {
    label: 'Not sent',
    hint: 'WhatsApp billing problem on our account — tell the tech team',
  },
};

/** Reasons our own side gives when nothing went out (suppressed sends, no provider). */
const SKIPPED_SEND_REASONS: Record<string, WhatsappFailure> = {
  provider_not_configured: {
    label: 'Not sent',
    hint: 'WhatsApp is not set up on this server — tell the tech team',
  },
  'WhatsApp is not set up': {
    label: 'Not sent',
    hint: 'WhatsApp is not set up on this server — tell the tech team',
  },
  template_not_configured: {
    label: 'Not sent',
    hint: 'The WhatsApp template is not set up — tell the tech team',
  },
  window_closed_no_template: {
    label: 'Not sent',
    hint: 'No WhatsApp template for this message — call them',
  },
  no_opt_in: {
    label: 'Not sent',
    hint: "They haven't agreed to WhatsApp messages — call them",
  },
};

/** Turns a raw failure ("131049: This message was not delivered to maintain healthy ecosystem
 *  engagement.", "WhatsApp error 131026", "provider_not_configured") into Placement's words.
 *  Template errors (132xxx) and anything unknown get a generic "Not delivered". */
export function whatsappFailureOf(failReason: string | null): WhatsappFailure {
  const raw = failReason?.trim() ?? '';
  const skipped = SKIPPED_SEND_REASONS[raw];
  if (skipped) return skipped;
  const code = /\b(13\d{4})\b/.exec(raw)?.[1];
  if (code && WHATSAPP_ERROR_CODES[code]) return WHATSAPP_ERROR_CODES[code];
  if (code?.startsWith('132')) {
    return {
      label: 'Not sent',
      hint: 'Problem with our WhatsApp template — tell the tech team',
    };
  }
  return { label: 'Not delivered', hint: "WhatsApp couldn't deliver it — call them" };
}
