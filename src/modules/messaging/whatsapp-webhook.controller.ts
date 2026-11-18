import { Request, Response } from 'express';
import { WhatsappWebhookParser } from './providers/whatsapp-provider.interface';
import { InboundPipelineService } from './inbound/inbound-pipeline.service';
import { WEBHOOK_RESPONSE_STATUS } from './messaging.constants';

/** Another consumer of the same webhook body (MSG91 posts every WhatsApp event to one URL) —
 *  today the driver invite's delivery reports. Must not throw. */
export type WebhookBodyListener = (body: unknown) => Promise<void>;

/**
 * POST /v1/webhooks/msg91/whatsapp?token=… — MSG91's inbound messages and delivery reports.
 * Only a wrong token gets a 4xx: MSG91 pauses a webhook that answers 4XX (except 429), so every
 * authenticated call is answered 200, also when nothing in it matches. If storing fails the error
 * propagates (5xx) and MSG91 re-delivers (at most 5 times) — nothing is acknowledged before it is
 * saved; the work itself (routing, business writes) runs later on the inbound queue.
 */
export class WhatsappWebhookController {
  private readonly listeners: WebhookBodyListener[] = [];

  constructor(
    private readonly parser: WhatsappWebhookParser,
    private readonly pipeline: InboundPipelineService,
  ) {}

  addBodyListener(listener: WebhookBodyListener): void {
    this.listeners.push(listener);
  }

  receive = async (request: Request, response: Response): Promise<void> => {
    const authenticated = this.parser.verifyRequest({
      headers: request.headers,
      query: request.query as Record<string, unknown>,
    });
    if (!authenticated) {
      console.warn('[messaging] MSG91 WhatsApp webhook rejected — missing or wrong token');
      response.sendStatus(WEBHOOK_RESPONSE_STATUS.unauthorized);
      return;
    }
    await this.pipeline.acceptEvents(this.parser.parse(request.body));
    for (const listener of this.listeners) {
      await listener(request.body).catch((error: unknown) =>
        console.error('[messaging] webhook body listener failed', error),
      );
    }
    response.sendStatus(WEBHOOK_RESPONSE_STATUS.ok);
  };
}
