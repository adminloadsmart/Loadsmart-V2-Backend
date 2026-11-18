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
  isComplete: boolean;
}

/** Truck + driver in one message: "PB10AB1234 Ramesh Kumar 9876543210", "hr26 ab 4321, Mohan, +91 99887 76655". */
export function parseDispatchDetails(text: string): DispatchDetails {
  const truckMatch = text.match(/[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{0,3}[\s-]?\d{4}/);
  const textWithoutTruck = truckMatch ? text.replace(truckMatch[0], ' ') : text;
  const mobileMatch = textWithoutTruck.match(/(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}/);
  const driverName = (
    mobileMatch ? textWithoutTruck.replace(mobileMatch[0], ' ') : textWithoutTruck
  )
    .replace(/[,;|:]/g, ' ')
    .replace(/\b(truck|driver|mobile|no|number|naam|name)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truckNumber = truckMatch ? truckMatch[0].toUpperCase().replace(/[\s-]/g, '') : null;
  const driverMobile = mobileMatch ? onlyDigits(mobileMatch[0]).slice(-INDIAN_MOBILE_DIGITS) : null;
  return {
    truckNumber,
    driverName,
    driverMobile,
    isComplete:
      truckNumber !== null &&
      INDIAN_TRUCK_NUMBER_PATTERN.test(truckNumber) &&
      driverMobile !== null &&
      INDIAN_MOBILE_PATTERN.test(driverMobile) &&
      driverName.length > 1,
  };
}

/** A truck number anywhere in the text, normalised (PB10AB1234), or null. */
export function findTruckNumber(text: string): { truckNumber: string; matched: string } | null {
  const truckMatch = text.match(/[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{0,3}[\s-]?\d{4}/);
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
