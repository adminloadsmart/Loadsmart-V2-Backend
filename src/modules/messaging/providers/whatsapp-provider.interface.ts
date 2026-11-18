import {
  DeliveryStatusEvent,
  InboundMessageType,
  SendErrorCode,
  WhatsappProviderName,
} from '../messaging.types';

/**
 * The WhatsApp provider port. Everything MSG91-specific lives behind it, in providers/msg91/. The
 * router, tables, parsers and template registry only see these types.
 */

// ---------------------------------------------------------------- outbound

export interface SendOptions {
  /** Quote this inbound message in our reply (shows the user which message we answer). */
  replyToProviderMessageId?: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string | null; providerRequestId: string | null }
  | { ok: false; errorCode: SendErrorCode; retryable: boolean; detail: string };

export interface TemplateMessage {
  templateName: string;
  languageCode: string;
  bodyVariables: string[];
  /** One payload per quick-reply button, in button order. MSG91 does not document a per-button
   *  payload in its send API, so the MSG91 adapter does not send it; taps are matched by the
   *  tapped message (replyMsgId) and the button text. */
  quickReplyPayloads?: string[];
  headerDocument?: { link: string; filename: string };
  /** The dynamic part of the template's URL buttons; `position` is the button's 1-based place. */
  urlButtons?: { position: number; value: string }[];
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ButtonsMessage {
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: ReplyButton[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListMessage {
  bodyText: string;
  buttonText: string;
  sectionTitle: string;
  rows: ListRow[];
}

export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string | null;
}

export interface WhatsappProviderCapabilities {
  sessionButtons: boolean;
  sessionLists: boolean;
  templateButtonPayload: boolean;
  replyContext: boolean;
}

export interface WhatsappProvider {
  readonly name: WhatsappProviderName;
  readonly capabilities: WhatsappProviderCapabilities;
  sendTemplate(
    toPhone: string,
    message: TemplateMessage,
    options?: SendOptions,
  ): Promise<SendResult>;
  sendText(toPhone: string, text: string, options?: SendOptions): Promise<SendResult>;
  sendButtons(toPhone: string, message: ButtonsMessage, options?: SendOptions): Promise<SendResult>;
  sendList(toPhone: string, message: ListMessage, options?: SendOptions): Promise<SendResult>;
  fetchMedia(mediaRef: string): Promise<FetchedMedia>;
}

// ---------------------------------------------------------------- inbound

export interface NormalizedMedia {
  /** Where to download the file (MSG91 gives a URL; links expire, plan note 15). */
  ref: string;
  mimeType: string | null;
  filename: string | null;
}

export interface NormalizedMessage {
  kind: 'message';
  provider: WhatsappProviderName;
  providerMessageId: string;
  fromPhone: string;
  fromUserId: string | null;
  /** The message id this one replies to or was tapped on (MSG91 `replyMsgId`). */
  contextMessageId: string | null;
  type: InboundMessageType;
  /** Provider's own type name, kept for 'other' (reaction, system, unsupported…). */
  providerType: string;
  text: string | null;
  /** Session reply-button id or template quick-reply payload. */
  buttonId: string | null;
  buttonText: string | null;
  listRowId: string | null;
  flowResponse: Record<string, unknown> | null;
  media: NormalizedMedia | null;
  timestamp: Date;
  raw: unknown;
}

export interface NormalizedStatus {
  kind: 'status';
  provider: WhatsappProviderName;
  providerMessageId: string | null;
  providerRequestId: string | null;
  recipientPhone: string | null;
  status: DeliveryStatusEvent;
  timestamp: Date;
  error: { code: string; title: string } | null;
  raw: unknown;
}

export type NormalizedEvent = NormalizedMessage | NormalizedStatus;

export interface IncomingWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export interface WhatsappWebhookParser {
  readonly provider: WhatsappProviderName;
  /** Authenticates a POST (MSG91: the `?token=` we put in the webhook URL). */
  verifyRequest(request: IncomingWebhookRequest): boolean;
  parse(body: unknown): NormalizedEvent[];
}
