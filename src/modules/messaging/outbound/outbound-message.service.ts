import { toIndianMsisdn } from '../../../shared/utils/phone-number';
import { JobQueue } from '../../../jobs/queue-registry';
import { applyChannelPolicy } from '../channel-policy';
import { LoadChannelFacts } from '../load-channel-facts';
import { MessageLogEntity } from '../entities/message-log.entity';
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  OUTBOUND_JOB_NAME,
  OUTBOUND_JOB_RETRY,
  SUPPRESSED_REASONS,
} from '../messaging.constants';
import {
  MessageRecipientKind,
  OutboundMessageKind,
  WhatsappProviderName,
} from '../messaging.types';
import { encodeOfferButtonId } from '../parsers/reply-value.parsers';
import {
  ButtonsMessage,
  ListMessage,
  SendResult,
  WhatsappProvider,
} from '../providers/whatsapp-provider.interface';
import { MessageLogPatch } from '../repositories/message-log.repository';
import {
  TemplateKey,
  getTemplateDefinition,
  offerActionsOf,
  orderTemplateVariables,
  renderTemplateBody,
} from '../templates/template-registry';

export interface OutboundRecipient {
  kind: MessageRecipientKind;
  /** The row a reply must update (load_recipients.id, partner id…); null for plain contacts. */
  refId: string | null;
  name: string | null;
  phone: string;
}

export interface OutboundLoadRef {
  tenantId: string | null;
  loadId: string | null;
  loadRef: string | null;
}

export type SessionContent =
  | { type: 'text'; text: string }
  | { type: 'buttons'; message: ButtonsMessage }
  | { type: 'list'; message: ListMessage };

export type OutboundContent =
  | SessionContent
  | {
      type: 'template';
      templateName: string;
      languageCode: string;
      bodyVariables: string[];
      quickReplyPayloads?: string[];
      headerDocument?: { link: string; filename: string };
    };

export interface TemplateSendRequest extends OutboundLoadRef {
  recipient: OutboundRecipient;
  templateKey: TemplateKey;
  variables: Record<string, string>;
  headerDocument?: { link: string; filename: string };
  replyToInboundId?: string | null;
  actor: string;
}

export interface SessionSendRequest extends OutboundLoadRef {
  recipient: OutboundRecipient;
  kind: OutboundMessageKind;
  content: SessionContent;
  /** Sent instead when the 24-h window has closed (finding G1); none = suppressed. */
  fallbackTemplate?: { templateKey: TemplateKey; variables: Record<string, string> };
  replyToInboundId?: string | null;
  actor: string;
}

export interface OutboundResult {
  messageLogId: string;
  status: 'queued' | 'suppressed';
  suppressedReason?: string;
}

export interface OutboundJobPayload {
  messageLogId: string;
  content: OutboundContent;
  toPhone: string;
  replyToProviderMessageId: string | null;
}

export interface OutboundMessageStore {
  createMessageLog(row: Partial<MessageLogEntity>): Promise<MessageLogEntity>;
  updateMessageLog(messageLogId: string, patch: MessageLogPatch): Promise<void>;
  latestInboundAt(phone: string): Promise<Date | null>;
  findInboundProviderMessageId(inboundId: string): Promise<string | null>;
}

/** WhatsApp opt-in per contact (Meta requires it). Interim: allow all (contact-consent.ts). */
export interface ContactConsent {
  hasWhatsappOptIn(recipient: OutboundRecipient): Promise<boolean>;
}

export interface OutboundConfig {
  provider: WhatsappProvider | null;
  providerName: WhatsappProviderName;
  templateNames: Record<string, string>;
  templateLanguage: string;
  /** Load facts for the channel rules (no WhatsApp to a shipper before the load memo). */
  loadFacts?: LoadChannelFacts;
  now?: () => Date;
}

/** Thrown for retryable send failures (network, rate limit) so BullMQ tries again. */
export class RetryableSendError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'RetryableSendError';
  }
}

/** Every WhatsApp number in one form, 91XXXXXXXXXX: masters store 10 digits, MSG91 reports and
 *  inbound messages carry the country code. */
const whatsappNumberOf = (value: string): string => toIndianMsisdn(value);

/**
 * Outbound WhatsApp, provider-neutral. Every message is first written to message_log (so its
 * WAMID can route replies and statuses), then queued; the worker sends one recipient per call.
 * Session messages respect the 24-h window: inside → sent; outside → the fallback template, if any.
 */
export class OutboundMessageService {
  private readonly now: () => Date;

  constructor(
    private readonly store: OutboundMessageStore,
    private readonly queue: JobQueue,
    private readonly consent: ContactConsent,
    private readonly config: OutboundConfig,
  ) {
    this.now = config.now ?? (() => new Date());
  }

  async isWindowOpen(phone: string): Promise<boolean> {
    const lastInboundAt = await this.store.latestInboundAt(whatsappNumberOf(phone));
    return (
      lastInboundAt !== null &&
      this.now().getTime() - lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS
    );
  }

  async sendTemplate(request: TemplateSendRequest): Promise<OutboundResult> {
    const definition = getTemplateDefinition(request.templateKey);
    const templateName = this.config.templateNames[request.templateKey];
    const bodyVariables = orderTemplateVariables(request.templateKey, request.variables);
    const baseRow = this.baseRow(request, definition.kind, request.recipient, {
      templateKey: request.templateKey,
      variables: request.variables,
      renderedText: renderTemplateBody(request.templateKey, request.variables),
      intent: definition.intent,
    });
    if (!templateName) return this.suppress(baseRow, SUPPRESSED_REASONS.templateNotConfigured);

    const quickReplyPayloads =
      request.recipient.refId && request.loadRef
        ? offerActionsOf(request.templateKey).map((action) =>
            encodeOfferButtonId({
              action,
              loadRef: request.loadRef!,
              recipientRef: request.recipient.refId!,
            }),
          )
        : [];
    return this.queueMessage(baseRow, request, {
      type: 'template',
      templateName,
      languageCode: this.config.templateLanguage,
      bodyVariables,
      ...(quickReplyPayloads.length > 0 ? { quickReplyPayloads } : {}),
      ...(request.headerDocument ? { headerDocument: request.headerDocument } : {}),
    });
  }

  async sendSession(request: SessionSendRequest): Promise<OutboundResult> {
    if (await this.isWindowOpen(request.recipient.phone)) {
      const baseRow = this.baseRow(request, request.kind, request.recipient, {
        renderedText: renderSession(request.content),
      });
      return this.queueMessage(baseRow, request, request.content);
    }
    if (request.fallbackTemplate) {
      return this.sendTemplate({
        ...request,
        templateKey: request.fallbackTemplate.templateKey,
        variables: request.fallbackTemplate.variables,
      });
    }
    const baseRow = this.baseRow(request, request.kind, request.recipient, {
      renderedText: renderSession(request.content),
    });
    return this.suppress(baseRow, SUPPRESSED_REASONS.windowClosedNoTemplate);
  }

  /**
   * A load offer with Accept / Negotiate / Reject (or the template's own actions). Uses the approved
   * template; while it isn't configured yet and the window is open (testing), the same choices go as
   * session reply buttons with the same ids, so replies route identically.
   */
  async sendOffer(
    request: TemplateSendRequest & { sessionBodyText: string },
  ): Promise<OutboundResult> {
    const definition = getTemplateDefinition(request.templateKey);
    if (
      this.config.templateNames[request.templateKey] ||
      !request.recipient.refId ||
      !request.loadRef
    ) {
      return this.sendTemplate(request);
    }
    // Quick replies only (a URL button has no session equivalent); our own ids, so a tap routes
    // by its id even without the tapped message.
    const buttons = (definition.buttons ?? []).flatMap((button) =>
      button.action
        ? [
            {
              id: encodeOfferButtonId({
                action: button.action,
                loadRef: request.loadRef!,
                recipientRef: request.recipient.refId!,
              }),
              title: button.title,
            },
          ]
        : [],
    );
    return this.sendSession({
      ...request,
      kind: definition.kind,
      content: {
        type: 'buttons',
        message: { headerText: request.loadRef, bodyText: request.sessionBodyText, buttons },
      },
    });
  }

  /** Worker step: send one queued message and record the provider ids or the failure. */
  async deliver(payload: OutboundJobPayload, isFinalAttempt: boolean): Promise<void> {
    const provider = this.config.provider;
    if (!provider) {
      await this.store.updateMessageLog(payload.messageLogId, {
        status: 'suppressed',
        suppressedReason: SUPPRESSED_REASONS.providerNotConfigured,
      });
      return;
    }
    const result = await sendThroughProvider(provider, payload);
    if (result.ok) {
      await this.store.updateMessageLog(payload.messageLogId, {
        status: 'submitted',
        providerMessageId: result.providerMessageId,
        providerRequestId: result.providerRequestId,
      });
      return;
    }
    if (result.retryable && !isFinalAttempt)
      throw new RetryableSendError(`${result.errorCode}: ${result.detail}`);
    if (result.errorCode === 'token_invalid') {
      console.error(
        '[messaging] WhatsApp provider token is invalid or expired — every send will fail until it is replaced',
      );
    }
    await this.store.updateMessageLog(payload.messageLogId, {
      status: 'failed',
      failedAt: this.now(),
      error: { code: result.errorCode, detail: result.detail },
    });
  }

  private baseRow(
    loadRef: OutboundLoadRef & { actor: string; replyToInboundId?: string | null },
    kind: OutboundMessageKind,
    recipient: OutboundRecipient,
    extra: Partial<MessageLogEntity>,
  ): Partial<MessageLogEntity> {
    return {
      tenantId: loadRef.tenantId,
      loadId: loadRef.loadId,
      loadRef: loadRef.loadRef,
      recipientKind: recipient.kind,
      recipientRefId: recipient.refId,
      recipientName: recipient.name,
      address: whatsappNumberOf(recipient.phone),
      channel: 'whatsapp',
      provider: this.config.providerName,
      kind,
      replyToInboundId: loadRef.replyToInboundId ?? null,
      actor: loadRef.actor,
      ...extra,
    };
  }

  /** The channel rules (channel-policy.ts) for this one WhatsApp message: the reason it may not
   *  go, or null. */
  private async channelRuleBlocking(row: Partial<MessageLogEntity>): Promise<string | null> {
    const needsLoad = row.recipientKind === 'shipper_user' && row.tenantId && row.loadId;
    const load =
      needsLoad && this.config.loadFacts
        ? await this.config.loadFacts.forLoad(row.tenantId!, row.loadId!)
        : null;
    const { suppressed } = applyChannelPolicy({
      recipientKind: row.recipientKind ?? 'contact',
      intent: row.intent ?? null,
      channels: ['whatsapp'],
      load,
    });
    return suppressed[0]?.reason ?? null;
  }

  private async suppress(row: Partial<MessageLogEntity>, reason: string): Promise<OutboundResult> {
    const messageLog = await this.store.createMessageLog({
      ...row,
      status: 'suppressed',
      suppressedReason: reason,
    });
    return { messageLogId: messageLog.id, status: 'suppressed', suppressedReason: reason };
  }

  private async queueMessage(
    row: Partial<MessageLogEntity>,
    request: { recipient: OutboundRecipient; replyToInboundId?: string | null },
    content: OutboundContent,
  ): Promise<OutboundResult> {
    const blockedBy = await this.channelRuleBlocking(row);
    if (blockedBy) return this.suppress(row, blockedBy);
    if (!(await this.consent.hasWhatsappOptIn(request.recipient)))
      return this.suppress(row, SUPPRESSED_REASONS.noOptIn);
    const messageLog = await this.store.createMessageLog({ ...row, status: 'queued' });
    const replyToProviderMessageId = request.replyToInboundId
      ? await this.store.findInboundProviderMessageId(request.replyToInboundId)
      : null;
    const payload: OutboundJobPayload = {
      messageLogId: messageLog.id,
      content,
      toPhone: whatsappNumberOf(request.recipient.phone),
      replyToProviderMessageId,
    };
    await this.queue.enqueue(OUTBOUND_JOB_NAME, payload, {
      jobId: messageLog.id,
      attempts: OUTBOUND_JOB_RETRY.attempts,
      backoff: { type: 'exponential', delay: OUTBOUND_JOB_RETRY.backoffMs },
    });
    return { messageLogId: messageLog.id, status: 'queued' };
  }
}

function renderSession(content: SessionContent): string {
  if (content.type === 'text') return content.text;
  if (content.type === 'buttons')
    return `${content.message.bodyText} [${content.message.buttons.map((button) => button.title).join(' | ')}]`;
  return `${content.message.bodyText} [${content.message.rows.map((row) => row.title).join(' | ')}]`;
}

function sendThroughProvider(
  provider: WhatsappProvider,
  payload: OutboundJobPayload,
): Promise<SendResult> {
  const options = payload.replyToProviderMessageId
    ? { replyToProviderMessageId: payload.replyToProviderMessageId }
    : undefined;
  const { content, toPhone } = payload;
  switch (content.type) {
    case 'template':
      return provider.sendTemplate(toPhone, content, options);
    case 'text':
      return provider.sendText(toPhone, content.text, options);
    case 'buttons':
      return provider.sendButtons(toPhone, content.message, options);
    case 'list':
      return provider.sendList(toPhone, content.message, options);
  }
}
