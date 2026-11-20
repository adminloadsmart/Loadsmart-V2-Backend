/**
 * MSG91 WhatsApp request ids and delivery reports. The exact field names were not verified
 * against MSG91's docs when this was written, so both readers below accept the common spellings
 * (`request_id`/`requestId`/`uuid`, `status`/`eventName`/`event`) — the webhook logs every raw
 * payload (see driver-invite-tracking.routes.ts), so check that log and narrow these once a real
 * report has come in.
 */

import {
  WHATSAPP_MESSAGE_ID_PREFIX,
  WHATSAPP_MESSAGE_ID_SEARCH_DEPTH,
} from '../shared/constants/msg91';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function firstString(source: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

const REQUEST_ID_KEYS = ['request_id', 'requestId', 'uuid', 'message_uuid', 'messageId'];

/** A Meta message id (WAMID, "wamid.…") anywhere in a send response, a few levels deep — only a
 *  value with that prefix is taken, so a request id can never pass for one. Null when MSG91
 *  returned none (today it is expected on the first delivery report instead). */
export function whatsappMessageIdOf(response: unknown, depth = 0): string | null {
  if (typeof response === 'string')
    return response.startsWith(WHATSAPP_MESSAGE_ID_PREFIX) ? response : null;
  if (depth > WHATSAPP_MESSAGE_ID_SEARCH_DEPTH || typeof response !== 'object' || response === null)
    return null;
  const values = Array.isArray(response) ? response : Object.values(response);
  for (const value of values) {
    const found = whatsappMessageIdOf(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The request id in sendWhatsapp's response — top-level or under `data`. */
export function whatsappRequestIdOf(response: unknown): string | null {
  if (!isObject(response)) return null;
  return (
    firstString(response, REQUEST_ID_KEYS) ??
    (isObject(response.data) ? firstString(response.data, REQUEST_ID_KEYS) : null)
  );
}

export type Msg91WhatsappReportStatus = 'delivered' | 'read' | 'failed';

export interface Msg91WhatsappReport {
  requestId: string;
  status: Msg91WhatsappReportStatus;
  at: Date;
}

const STATUS_BY_EVENT: Record<string, Msg91WhatsappReportStatus> = {
  delivered: 'delivered',
  read: 'read',
  seen: 'read',
  failed: 'failed',
  undelivered: 'failed',
  rejected: 'failed',
};

/** A report's time — epoch seconds/ms or an ISO string; now if missing or unparseable. */
function reportTime(item: Json): Date {
  const raw = item.ts ?? item.timestamp ?? item.updatedAt ?? item.updated_at;
  if (typeof raw === 'number') return new Date(raw < 1e12 ? raw * 1000 : raw);
  if (typeof raw === 'string') {
    const parsed = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed < 1e12 ? parsed * 1000 : parsed);
  }
  return new Date();
}

/** Every delivered/read/failed report in a webhook body — one object, an array, or wrapped in
 *  `data`. `sent`/`submitted` and anything unrecognised are left out. */
export function parseMsg91WhatsappReports(body: unknown): Msg91WhatsappReport[] {
  const items = Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body.data)
      ? body.data
      : [body];
  return items.flatMap((item): Msg91WhatsappReport[] => {
    if (!isObject(item)) return [];
    const requestId = whatsappRequestIdOf(item);
    const event = firstString(item, ['status', 'eventName', 'event', 'message_status']);
    const status = event ? STATUS_BY_EVENT[event.toLowerCase()] : undefined;
    return requestId && status ? [{ requestId, status, at: reportTime(item) }] : [];
  });
}
