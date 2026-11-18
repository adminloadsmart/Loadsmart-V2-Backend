import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { MSG91_WHATSAPP_WEBHOOK_PATH } from './messaging.constants';

export function createWhatsappWebhookRoutes(controller: WhatsappWebhookController): Router {
  const router = Router();
  router.post(MSG91_WHATSAPP_WEBHOOK_PATH, asyncHandler(controller.receive));
  return router;
}
