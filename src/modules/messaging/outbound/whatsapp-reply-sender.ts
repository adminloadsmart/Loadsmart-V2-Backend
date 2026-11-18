import {
  LOAD_PICKER_LABELS,
  PROMPT_FALLBACK_TEMPLATES,
  WHATSAPP_INTERACTIVE_LIMITS,
  MESSAGING_ACTORS,
} from '../messaging.constants';
import { ReplyPrompt } from '../messaging.types';
import { encodeLoadRowId } from '../parsers/reply-value.parsers';
import { REPLY_TEXTS } from '../router/reply-texts';
import {
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplySender,
  SenderIdentity,
} from '../router/reply-router.ports';
import { TemplateKey } from '../templates/template-registry';
import { OutboundMessageService, SessionContent } from './outbound-message.service';

const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;

/** The router's ReplySender: every reply quotes the message it answers and is logged in message_log. */
export class WhatsappReplySender implements ReplySender {
  constructor(private readonly outbound: OutboundMessageService) {}

  async sendInfo(sender: SenderIdentity, text: string, replyToInboundId: string): Promise<void> {
    await this.outbound.sendSession({
      recipient: { kind: 'contact', refId: null, name: null, phone: sender.phone },
      tenantId: null,
      loadId: null,
      loadRef: null,
      kind: 'info',
      content: { type: 'text', text },
      replyToInboundId,
      actor: MESSAGING_ACTORS.replyRouter,
    });
  }

  async sendPrompt(
    context: RecipientLoadContext,
    sender: SenderIdentity,
    prompt: ReplyPrompt,
    replyToInboundId: string,
  ): Promise<void> {
    const fallbackTemplateKey = PROMPT_FALLBACK_TEMPLATES[prompt] as TemplateKey | null;
    await this.outbound.sendSession({
      recipient: {
        kind: context.recipientKind,
        refId: context.recipientRefId,
        name: null,
        phone: sender.phone,
      },
      tenantId: context.tenantId,
      loadId: context.loadId,
      loadRef: context.loadRef,
      kind: prompt,
      content: this.promptContent(context, prompt),
      ...(fallbackTemplateKey
        ? {
            fallbackTemplate: {
              templateKey: fallbackTemplateKey,
              variables: { loadRef: context.loadRef },
            },
          }
        : {}),
      replyToInboundId,
      actor: MESSAGING_ACTORS.replyRouter,
    });
  }

  async sendLoadPicker(
    sender: SenderIdentity,
    candidates: OpenRecipientLoad[],
    promptText: string,
    replyToInboundId: string,
  ): Promise<string | null> {
    const rows = candidates.slice(0, WHATSAPP_INTERACTIVE_LIMITS.listRowsMax).map((load) => ({
      id: encodeLoadRowId(load.loadRef),
      title: truncate(load.loadRef, WHATSAPP_INTERACTIVE_LIMITS.listRowTitleMaxChars),
      description: truncate(load.laneLabel, WHATSAPP_INTERACTIVE_LIMITS.listRowDescriptionMaxChars),
    }));
    const result = await this.outbound.sendSession({
      recipient: { kind: 'contact', refId: null, name: null, phone: sender.phone },
      tenantId: null,
      loadId: null,
      loadRef: null,
      kind: 'picker',
      content: {
        type: 'list',
        message: {
          bodyText: truncate(promptText, WHATSAPP_INTERACTIVE_LIMITS.bodyMaxChars),
          buttonText: LOAD_PICKER_LABELS.buttonText,
          sectionTitle: LOAD_PICKER_LABELS.sectionTitle,
          rows,
        },
      },
      replyToInboundId,
      actor: MESSAGING_ACTORS.replyRouter,
    });
    return result.status === 'queued' ? result.messageLogId : null;
  }

  /** The question as a text the user answers by swiping (quoting) it. */
  private promptContent(context: RecipientLoadContext, prompt: ReplyPrompt): SessionContent {
    const text =
      prompt === 'rate_request'
        ? REPLY_TEXTS.rateRequest(context.loadRef)
        : prompt === 'dispatch_request'
          ? REPLY_TEXTS.dispatchRequest(context.loadRef)
          : REPLY_TEXTS.slipRequest(context.loadRef);
    return { type: 'text', text };
  }
}
