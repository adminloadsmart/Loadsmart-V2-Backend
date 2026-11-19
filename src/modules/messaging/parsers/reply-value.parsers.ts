import {
  BUTTON_ID_SEPARATOR,
  INDIAN_MOBILE_DIGITS,
  INDIAN_MOBILE_PATTERN,
  INDIAN_TRUCK_NUMBER_PATTERN,
  LIST_ROW_ID_PREFIX,
  RATE_SUFFIX_MULTIPLIER,
  TYPED_RATE_RANGE,
} from '../messaging.constants';
import { OFFER_ACTIONS, OfferAction, ReplyValueKind } from '../messaging.types';

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

/**
 * A typed rate: "45000", "45,000/-", "₹45000", "Rs 45000", "45k", "45 K", "45 hazar".
 * Returns null outside TYPED_RATE_RANGE so times or counts ("10 baje") are never read as a rate.
 */
export function parseTypedRate(text: string): number | null {
  const rateMatch = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|hazar|thousand)?/i);
  if (!rateMatch) return null;
  const amount = Math.round(Number(rateMatch[1]) * (rateMatch[2] ? RATE_SUFFIX_MULTIPLIER : 1));
  return amount >= TYPED_RATE_RANGE.min && amount <= TYPED_RATE_RANGE.max ? amount : null;
}

export interface DispatchDetails {
  truckNumber: string | null;
  driverName: string;
  driverMobile: string | null;
  /** The driving licence, normalised (HR3120210000616), or null. */
  licenceNumber: string | null;
  /** The driver's date of birth as YYYY-MM-DD, or null. */
  dateOfBirth: string | null;
  /** A driver name and a valid mobile are in. The truck, licence and date of birth are checked
   *  by whoever takes the details (the truck may already be on the load). */
  isComplete: boolean;
}

/** An Indian driving licence: state, RTO, year of issue, 7 digits — "HR3120210000616",
 *  "HR-31 2021 0000616", "PB10 20190012345". */
const LICENCE_PATTERN = /\b[A-Za-z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}[\s-]?\d{7}\b/;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "12 MAY 1990", "12 May, 1990", "12-05-1990", "12/05/1990", "12.05.1990" or "1990-05-12". */
const DATE_PATTERNS: { pattern: RegExp; parts: (match: RegExpMatchArray) => number[] | null }[] = [
  {
    pattern: /\b(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})\b/,
    parts: (match) => {
      const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
      return month ? [Number(match[3]), month, Number(match[1])] : null;
    },
  },
  {
    pattern: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    parts: (match) => [Number(match[1]), Number(match[2]), Number(match[3])],
  },
  {
    pattern: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/,
    parts: (match) => [Number(match[3]), Number(match[2]), Number(match[1])],
  },
];

/** Years a driver's date of birth can fall in — keeps a spaced truck number ("MH 12 MAR 1234")
 *  from reading as a date. */
const BIRTH_YEAR_MIN = 1920;
const BIRTH_YEAR_MAX = 2015;

/** A real calendar date as YYYY-MM-DD, or null (31 Feb, month 13, an unlikely birth year…). */
function isoDateOf(year: number, month: number, day: number): string | null {
  if (year < BIRTH_YEAR_MIN || year > BIRTH_YEAR_MAX) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function findDate(text: string): { iso: string; matched: string } | null {
  for (const { pattern, parts } of DATE_PATTERNS) {
    const match = text.match(pattern);
    const ymd = match ? parts(match) : null;
    const iso = ymd ? isoDateOf(ymd[0], ymd[1], ymd[2]) : null;
    if (match && iso) return { iso, matched: match[0] };
  }
  return null;
}

/**
 * Truck and driver details in one message, any order, one per line or not:
 * "PB10AB1234 Ramesh Kumar 9876543210", "hr26 ab 4321, Mohan, +91 99887 76655",
 * "RJ11GC9628\nSHUBHAM\n7973805477\nHR3120210000616\n12 MAY 1990".
 * The licence and the date go first: a licence starts like a truck number (HR31 2021…).
 */
export function parseDispatchDetails(text: string): DispatchDetails {
  let rest = ` ${text} `;
  const licenceMatch = rest.match(LICENCE_PATTERN);
  if (licenceMatch) rest = rest.replace(licenceMatch[0], ' ');
  const date = findDate(rest);
  if (date) rest = rest.replace(date.matched, ' ');
  const truckMatch = rest.match(/\b[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{0,3}[\s-]?\d{4}(?!\d)/);
  if (truckMatch) rest = rest.replace(truckMatch[0], ' ');
  const mobileMatch = rest.match(/(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}/);
  if (mobileMatch) rest = rest.replace(mobileMatch[0], ' ');
  const driverName = rest
    .replace(/[,;|:]/g, ' ')
    .replace(
      /\b(truck|driver|mobile|no|number|naam|name|dl|licence|license|dob|date|of|birth)\b\.?/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const truckNumber = truckMatch ? truckMatch[0].toUpperCase().replace(/[\s-]/g, '') : null;
  const driverMobile = mobileMatch ? onlyDigits(mobileMatch[0]).slice(-INDIAN_MOBILE_DIGITS) : null;
  return {
    truckNumber: truckNumber && INDIAN_TRUCK_NUMBER_PATTERN.test(truckNumber) ? truckNumber : null,
    driverName,
    driverMobile,
    licenceNumber: licenceMatch ? licenceMatch[0].toUpperCase().replace(/[\s-]/g, '') : null,
    dateOfBirth: date?.iso ?? null,
    isComplete:
      driverMobile !== null && INDIAN_MOBILE_PATTERN.test(driverMobile) && driverName.length > 1,
  };
}

/** A truck number anywhere in the text, normalised (PB10AB1234), or null. */
export function findTruckNumber(text: string): { truckNumber: string; matched: string } | null {
  const truckMatch = text.match(/\b[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{0,3}[\s-]?\d{4}(?!\d)/);
  if (!truckMatch) return null;
  const truckNumber = truckMatch[0].toUpperCase().replace(/[\s-]/g, '');
  return INDIAN_TRUCK_NUMBER_PATTERN.test(truckNumber)
    ? { truckNumber, matched: truckMatch[0] }
    : null;
}

export type ClassifiedText =
  | { kind: Extract<ReplyValueKind, 'rate'>; rate: number; truckNumber: string | null }
  | { kind: Extract<ReplyValueKind, 'truck'>; truckNumber: string }
  | { kind: Extract<ReplyValueKind, 'dispatch'>; dispatch: DispatchDetails }
  | { kind: null };

/**
 * Decides what a free-text reply is (catalog CTAs: "Type your rate in ₹ and the truck number";
 * "Send the truck number if you have it"):
 * - a driver mobile in it → truck/driver details (not taken on WhatsApp yet; a mobile is not a rate);
 * - a rate, with or without a truck number → rate (+ truck);
 * - only a truck number → truck.
 */
export function classifyTypedReply(text: string): ClassifiedText {
  const dispatch = parseDispatchDetails(text);
  if (dispatch.driverMobile) return { kind: 'dispatch', dispatch };
  const truck = findTruckNumber(text);
  const rate = parseTypedRate(truck ? text.replace(truck.matched, ' ') : text);
  if (rate !== null) return { kind: 'rate', rate, truckNumber: truck?.truckNumber ?? null };
  if (truck) return { kind: 'truck', truckNumber: truck.truckNumber };
  return { kind: null };
}

// ---------------------------------------------------------------- our ids inside interactive messages

export interface OfferButtonId {
  action: OfferAction;
  loadRef: string;
  recipientRef: string;
}

export function encodeOfferButtonId({ action, loadRef, recipientRef }: OfferButtonId): string {
  return [action, loadRef, recipientRef].join(BUTTON_ID_SEPARATOR);
}

export function decodeOfferButtonId(buttonId: string | null): OfferButtonId | null {
  if (!buttonId) return null;
  const [action, loadRef, recipientRef] = buttonId.split(BUTTON_ID_SEPARATOR);
  if (
    !action ||
    !loadRef ||
    !recipientRef ||
    !(OFFER_ACTIONS as readonly string[]).includes(action)
  )
    return null;
  return { action: action as OfferAction, loadRef, recipientRef };
}

export const encodeLoadRowId = (loadRef: string): string => `${LIST_ROW_ID_PREFIX}${loadRef}`;

export function decodeLoadRowId(rowId: string | null): string | null {
  return rowId?.startsWith(LIST_ROW_ID_PREFIX)
    ? rowId.slice(LIST_ROW_ID_PREFIX.length) || null
    : null;
}
