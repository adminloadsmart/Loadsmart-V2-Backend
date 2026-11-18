import { Msg91Client, Msg91WhatsappSendOutcome } from '../../../../adapters/msg91.client';
import { whatsappRequestIdOf } from '../../../../adapters/msg91-whatsapp-report';
import {
  ButtonsMessage,
  FetchedMedia,
  ListMessage,
  SendResult,
  TemplateMessage,
  WhatsappProvider,
  WhatsappProviderCapabilities,
} from '../whatsapp-provider.interface';
import { MSG91_AUTH_HTTP, MSG91_RETRYABLE_HTTP } from './msg91.constants';

type SendPort = Pick<Msg91Client, 'postWhatsappTemplate' | 'postWhatsappSession'>;
type FetchFunction = typeof fetch;

/** MSG91's answer → our send result. MSG91 answers `{ status: 'success', hasError: false, … }`
 *  with a request id; the Meta WAMID arrives later on the first report (plan note 17), so
 *  providerMessageId stays null here and is filled from the report by request id. */
export function sendResultOf(outcome: Msg91WhatsappSendOutcome): SendResult {
  if (outcome.skipped) {
    return {
      ok: false,
      errorCode: 'recipient_not_allowed',
      retryable: false,
      detail: 'test number skipped (MSG91_SKIP_TEST_NUMBERS)',
    };
  }
  const body = outcome.body;
  const accepted =
    outcome.httpStatus >= 200 &&
    outcome.httpStatus < 300 &&
    body?.status === 'success' &&
    !body?.hasError;
  if (accepted) {
    return { ok: true, providerMessageId: null, providerRequestId: whatsappRequestIdOf(body) };
  }
  const detail = `HTTP ${outcome.httpStatus}: ${body ? JSON.stringify(body).slice(0, 500) : 'no JSON body'}`;
  if (MSG91_AUTH_HTTP.includes(outcome.httpStatus))
    return { ok: false, errorCode: 'token_invalid', retryable: false, detail };
  if (MSG91_RETRYABLE_HTTP.includes(outcome.httpStatus)) {
    return {
      ok: false,
      errorCode: outcome.httpStatus === 429 ? 'rate_limited' : 'network',
      retryable: true,
      detail,
    };
  }
  return { ok: false, errorCode: 'unknown', retryable: false, detail };
}

/**
 * WhatsApp through MSG91. Templates go through the same bulk endpoint and `{{var_N}}` convention
 * as the notifications module's WhatsappChannel; session text / buttons / lists through MSG91's
 * session API (inside the 24-hour window). MSG91 does not document quoting a message in a reply
 * or a per-button payload on templates, so neither is sent.
 */
export class Msg91WhatsappProvider implements WhatsappProvider {
  readonly name = 'msg91' as const;

  readonly capabilities: WhatsappProviderCapabilities = {
    sessionButtons: true,
    sessionLists: true,
    templateButtonPayload: false,
    replyContext: false,
  };

  constructor(
    private readonly client: SendPort,
    private readonly fetchImplementation: FetchFunction = fetch,
  ) {}

  async sendTemplate(toPhone: string, message: TemplateMessage): Promise<SendResult> {
    return this.guard(() =>
      this.client.postWhatsappTemplate(
        toPhone,
        message.templateName,
        message.bodyVariables,
        message.languageCode,
      ),
    );
  }

  async sendText(toPhone: string, text: string): Promise<SendResult> {
    return this.guard(() =>
      this.client.postWhatsappSession(toPhone, { contentType: 'text', text }),
    );
  }

  async sendButtons(toPhone: string, message: ButtonsMessage): Promise<SendResult> {
    return this.guard(() =>
      this.client.postWhatsappSession(toPhone, {
        contentType: 'interactive',
        interactive: {
          type: 'button',
          ...(message.headerText ? { header: { type: 'text', text: message.headerText } } : {}),
          body: { text: message.bodyText },
          ...(message.footerText ? { footer: { text: message.footerText } } : {}),
          action: {
            buttons: message.buttons.map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      }),
    );
  }

  async sendList(toPhone: string, message: ListMessage): Promise<SendResult> {
    return this.guard(() =>
      this.client.postWhatsappSession(toPhone, {
        contentType: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.bodyText },
          action: {
            button: message.buttonText,
            sections: [
              {
                title: message.sectionTitle,
                rows: message.rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  ...(row.description ? { description: row.description } : {}),
                })),
              },
            ],
          },
        },
      }),
    );
  }

  /** MSG91 gives inbound media as a direct link (valid 7 days per the MSG91 rep, 30 per its help
   *  page — plan note 15), so it is fetched straight away. */
  async fetchMedia(mediaRef: string): Promise<FetchedMedia> {
    const response = await this.fetchImplementation(mediaRef);
    if (!response.ok) throw new Error(`MSG91 media download failed: HTTP ${response.status}`);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type'),
    };
  }

  private async guard(send: () => Promise<Msg91WhatsappSendOutcome>): Promise<SendResult> {
    try {
      return sendResultOf(await send());
    } catch (error) {
      // fetch() itself failed (DNS, reset, timeout) — worth a retry.
      return { ok: false, errorCode: 'network', retryable: true, detail: String(error) };
    }
  }
}
