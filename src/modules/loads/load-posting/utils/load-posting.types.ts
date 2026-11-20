/**
 * Post-a-load value sets — each declared once as a `const` tuple (same pattern as
 * loads/utils/loads.types.ts) so the entity enums, zod validators and services can't drift.
 */

/** "How it moves" — Market fleet (Loadsmart + ticked transporters), Indent (one contracted
 *  transporter at the contract rate) or Own fleet (one of the shipper's own trucks). */
export const POST_MODES = ['market_fleet', 'indent', 'own_fleet'] as const;
export type PostMode = (typeof POST_MODES)[number];

export const RECIPIENT_TYPES = ['loadsmart', 'transporter'] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const MESSAGE_STATUSES = ['pending', 'sent', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** A transporter's answer to the offer on WhatsApp (Accept / Reject); null until they answer. */
/** A transporter's answer to an offer, shown to the shipper: `negotiating` = tapped Negotiate /
 *  Give rate and the rate is still to come. */
export const RECIPIENT_REPLIES = ['accepted', 'rejected', 'negotiating'] as const;
export type RecipientReply = (typeof RECIPIENT_REPLIES)[number];

export const BALANCE_PAID_BY = ['shipper', 'consignee'] as const;
export type BalancePaidBy = (typeof BALANCE_PAID_BY)[number];

export const PRICE_MODES = ['set_target', 'ask_for_quotes'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const PRICE_BASES = ['per_trip', 'per_tonne'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** The only advance percentages offered as chips; "Other" accepts any whole number 1–100. */
export const ADVANCE_PRESETS = [70, 80, 90, 100] as const;
export const DEFAULT_ADVANCE_PERCENTAGE = 80;

export const NOTE_MAX_LENGTH = 300;
/** Optional shipper-given name for a posting, e.g. "Cement to Surat - Oct". */
export const TITLE_MAX_LENGTH = 100;

/** Where a typed address came from — only 'master' rows already exist in a master table. */
export const ADDRESS_SOURCES = ['master', 'google', 'pincode'] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/** Address snapshot stored on the posting. Masters-linked picks also carry the master id on the
 *  posting itself; google/pincode ones are saved to the right master on post. */
export interface PostAddress {
  label: string;
  addressLine1: string | null;
  areaLocality: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  latitude: number | null;
  longitude: number | null;
  source: AddressSource;
}

/** A truck-type picker choice as stored on a posting (see TruckPickInput in the interface file). */
export interface TruckPick {
  body: 'open' | 'closed';
  wheel: number | string;
  capacityTons: number;
  bodyLengthFt: string;
}

/** Where one transporter is on one load, furthest step first wins — the shipper's "Who is
 *  quoting" row (GET /loads/post/:postingId?loadId=). */
export const RECIPIENT_QUOTE_STEPS = [
  'sending',
  'not_delivered',
  'sent',
  'delivered',
  'seen',
  'negotiating',
  'accepted',
  'rejected',
  'bid_no_truck',
  'bid_with_truck',
  'countered',
  'bid_expired',
  'bid_rejected',
  'not_chosen',
  'awarded',
  'closed',
] as const;
export type RecipientQuoteStep = (typeof RECIPIENT_QUOTE_STEPS)[number];

/** An offer delivered or read with no answer for this long → "call them" (catalog LS_N_0105:
 *  unread after 30 minutes goes to the call list). */
export const QUOTE_NO_ANSWER_CALL_AFTER_MS = 30 * 60 * 1000;
