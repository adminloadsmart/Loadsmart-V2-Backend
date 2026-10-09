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

export const BALANCE_PAID_BY = ['shipper', 'consignee'] as const;
export type BalancePaidBy = (typeof BALANCE_PAID_BY)[number];

export const PRICE_MODES = ['set_target', 'ask_for_quotes'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const PRICE_BASES = ['per_trip', 'per_tonne'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** The only advance percentages offered as chips; "Other" accepts any whole number 1–100. */
export const ADVANCE_PRESETS = [70, 80, 90, 100] as const;
export const DEFAULT_ADVANCE_PERCENTAGE = 80;

/** Earliest allowed pickup is this far after posting, rounded up to the next half hour. */
export const MIN_PICKUP_LEAD_HOURS = 3;
export const NOTE_MAX_LENGTH = 300;

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
