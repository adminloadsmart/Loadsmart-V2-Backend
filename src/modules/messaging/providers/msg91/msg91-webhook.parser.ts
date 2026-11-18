import { toIndianMsisdn } from '../../../../shared/utils/phone-number';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DeliveryStatusEvent, InboundMessageType } from '../../messaging.types';
import {
  IncomingWebhookRequest,
  NormalizedEvent,
  NormalizedMedia,
  NormalizedMessage,
  NormalizedStatus,
  WhatsappWebhookParser,
} from '../whatsapp-provider.interface';
import {
  EPOCH_MILLISECONDS_FLOOR,
  MILLISECONDS_PER_SECOND,
  MSG91_DIRECTION_INBOUND,
  MSG91_DIRECTION_OUTBOUND,
  MSG91_STATUS_EVENTS,
  MSG91_STRINGIFIED_FIELDS,
} from './msg91.constants';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** MSG91 sends some fields as JSON strings ("messages, content, button etc"); `button` can even be
 *  encoded twice. Parse until it stops being a JSON string. */
function parseJsonLoosely(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth++) {
    const trimmed = current.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) break;
    try {
      current = JSON.parse(trimmed);
    } catch {
      break;
    }
  }
  return current;
}

function text(source: Json | undefined, ...keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/** Numbers as 91XXXXXXXXXX, the form message_log.address uses. */
const onlyDigits = (value: string | null): string => (value ? toIndianMsisdn(value) : '');

/** `ts` / `timestamp`: epoch seconds or milliseconds, or an ISO string; now if missing. */
function timeOf(item: Json): Date {
  const raw = item.ts ?? item.timestamp ?? item.updatedAt ?? item.requestedAt;
  const numeric =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : null;
  if (numeric !== null)
    return new Date(
      numeric < EPOCH_MILLISECONDS_FLOOR ? numeric * MILLISECONDS_PER_SECOND : numeric,
    );
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) return new Date(raw);
  return new Date();
}

/** Every item in a webhook body (one object, an array, or wrapped in `data`), with the
 *  stringified fields parsed. */
function itemsOf(body: unknown): Json[] {
  const list = Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body.data)
      ? body.data
      : [body];
  return list.filter(isObject).map((item) => {
    const parsed: Json = { ...item };
    for (const field of MSG91_STRINGIFIED_FIELDS) {
      if (field in parsed) parsed[field] = parseJsonLoosely(parsed[field]);
    }
    return parsed;
  });
}

function isInbound(item: Json): boolean {
  const direction = item.direction;
  if (direction !== undefined && direction !== null) {
    const value = String(direction).toLowerCase();
    if (value === MSG91_DIRECTION_INBOUND || value === 'inbound') return true;
    if (value === MSG91_DIRECTION_OUTBOUND || value === 'outbound') return false;
  }
  // No direction: a report carries a known status event; anything else with a sender is inbound.
  const event = text(item, 'eventName', 'status')?.toLowerCase();
  if (event && (MSG91_STATUS_EVENTS as readonly string[]).includes(event)) return false;
  return Boolean(text(item, 'customerNumber', 'from'));
}

/** Where a session reply's interactive object can sit: `content` (stringified) or `interactive`. */
function interactiveOf(item: Json): Json | null {
  for (const candidate of [item.interactive, item.content]) {
    if (!isObject(candidate)) continue;
    const inner = isObject(candidate.interactive) ? (candidate.interactive as Json) : candidate;
    if (inner.button_reply || inner.list_reply || inner.nfm_reply) return inner;
  }
  return null;
}

function mediaOf(item: Json): NormalizedMedia | null {
  const content = isObject(item.content) ? (item.content as Json) : undefined;
  const nested =
    content &&
    (isObject(content.image)
      ? (content.image as Json)
      : isObject(content.document)
        ? (content.document as Json)
        : content);
  const ref = text(nested, 'url', 'link', 'mediaUrl') ?? text(item, 'url', 'mediaUrl', 'link');
  if (!ref) return null;
  return {
    ref,
    mimeType: text(nested, 'mime_type', 'mimeType') ?? text(item, 'mime_type', 'mimeType'),
    filename: text(nested, 'filename', 'fileName') ?? text(item, 'filename', 'fileName'),
  };
}

/** A stable id for an inbound message that came without one, so a re-delivery still dedupes. */
function fallbackMessageId(item: Json): string {
  const seed = [
    text(item, 'customerNumber', 'from'),
    text(item, 'ts', 'timestamp'),
    JSON.stringify(item.text ?? item.content ?? item.button ?? ''),
  ].join('|');
  return `msg91-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function toMessage(item: Json): NormalizedMessage {
  const contentType = (text(item, 'contentType', 'messageType', 'type') ?? 'unknown').toLowerCase();
  const message: NormalizedMessage = {
    kind: 'message',
    provider: 'msg91',
    providerMessageId:
      text(item, 'uuid', 'messageId', 'message_id', 'id') ?? fallbackMessageId(item),
    fromPhone: onlyDigits(text(item, 'customerNumber', 'from')),
    fromUserId: text(item, 'customerUserId', 'from_user_id', 'userId'),
    contextMessageId: text(item, 'replyMsgId', 'reply_msg_id', 'contextMessageId'),
    type: 'other',
    providerType: contentType,
    text: null,
    buttonId: null,
    buttonText: null,
    listRowId: null,
    flowResponse: null,
    media: null,
    timestamp: timeOf(item),
    raw: item,
  };

  // Template quick reply: `button` = {"payload": "…", "text": "…"} (stringified).
  if (isObject(item.button)) {
    const button = item.button as Json;
    return {
      ...message,
      type: 'button',
      buttonId: text(button, 'payload', 'id'),
      buttonText: text(button, 'text', 'title'),
    };
  }
  const interactive = interactiveOf(item);
  if (interactive?.button_reply && isObject(interactive.button_reply)) {
    const reply = interactive.button_reply as Json;
    return {
      ...message,
      type: 'button',
      buttonId: text(reply, 'id'),
      buttonText: text(reply, 'title'),
    };
  }
  if (interactive?.list_reply && isObject(interactive.list_reply)) {
    const reply = interactive.list_reply as Json;
    return {
      ...message,
      type: 'list_pick',
      listRowId: text(reply, 'id'),
      buttonText: text(reply, 'title'),
    };
  }
  if (interactive?.nfm_reply && isObject(interactive.nfm_reply)) {
    const responseJson = parseJsonLoosely((interactive.nfm_reply as Json).response_json);
    return {
      ...message,
      type: 'flow_reply',
      flowResponse: isObject(responseJson) ? responseJson : null,
    };
  }
  const mediaType: InboundMessageType | null = contentType.includes('image')
    ? 'image'
    : contentType.includes('document')
      ? 'document'
      : null;
  if (mediaType)
    return { ...message, type: mediaType, media: mediaOf(item), text: text(item, 'caption') };
  const body = isObject(item.text) ? text(item.text as Json, 'body') : text(item, 'text');
  const contentText = isObject(item.content)
    ? text(item.content as Json, 'text', 'body')
    : typeof item.content === 'string'
      ? item.content
      : null;
  const value = body ?? contentText;
  return value ? { ...message, type: 'text', text: value } : message;
}

function toStatus(item: Json): NormalizedStatus | null {
  const event = text(item, 'eventName', 'status', 'event')?.toLowerCase();
  if (!event || !(MSG91_STATUS_EVENTS as readonly string[]).includes(event)) return null;
  const errors = Array.isArray(item.errors) ? item.errors.filter(isObject) : [];
  const firstError = errors[0];
  return {
    kind: 'status',
    provider: 'msg91',
    // MSG91: `uuid` = "Unique ID for every message generated by Meta" (the WAMID).
    providerMessageId: text(item, 'uuid', 'messageId'),
    providerRequestId: text(item, 'requestId', 'request_id'),
    recipientPhone: onlyDigits(text(item, 'customerNumber', 'to')) || null,
    status: event as DeliveryStatusEvent,
    timestamp: timeOf(item),
    error:
      event === 'failed'
        ? {
            code: text(firstError, 'code') ?? text(item, 'errorCode') ?? 'failed',
            title:
              text(firstError, 'title', 'message') ??
              text(item, 'reason', 'failureReason') ??
              'failed',
          }
        : null,
    raw: item,
  };
}

/** MSG91's WhatsApp webhook (New): inbound messages and delivery reports on one URL. */
export class Msg91WebhookParser implements WhatsappWebhookParser {
  readonly provider = 'msg91' as const;

  constructor(private readonly config: { token: string | undefined }) {}

  /** The URL configured in the MSG91 panel carries `?token=` (same as the driver-invite reports). */
  verifyRequest(request: IncomingWebhookRequest): boolean {
    const token = request.query.token;
    if (!this.config.token || typeof token !== 'string') return false;
    const expected = Buffer.from(this.config.token);
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  parse(body: unknown): NormalizedEvent[] {
    return itemsOf(body).flatMap((item): NormalizedEvent[] => {
      if (isInbound(item)) {
        const message = toMessage(item);
        return message.fromPhone ? [message] : [];
      }
      const status = toStatus(item);
      return status ? [status] : [];
    });
  }
}
