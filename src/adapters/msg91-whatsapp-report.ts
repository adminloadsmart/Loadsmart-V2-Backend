/**
 * MSG91 WhatsApp request ids and delivery reports. The exact field names were not verified
 * against MSG91's docs when this was written, so both readers below accept the common spellings
 * (`request_id`/`requestId`/`uuid`, `status`/`eventName`/`event`) — the webhook logs every raw
 * payload (see driver-invite-tracking.routes.ts), so check that log and narrow these once a real
 * report has come in.
 */

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
