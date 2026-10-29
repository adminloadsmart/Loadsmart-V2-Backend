import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { DriverInviteTrackingController } from './driver-invite-tracking.controller';
import { DRIVER_INVITE_LINK_RATE_LIMIT } from './driver.constants';

/**
 * Public (no login) endpoints behind the driver invite's WhatsApp — mounted in publicRouters, so
 * both paths are under /v1:
 * - GET  /driver-invites/open/:token — the tracked app link in the message.
 * - POST /webhooks/msg91/whatsapp?token=… — MSG91's delivery reports.
 */
export function createDriverInviteTrackingRoutes(
  controller: DriverInviteTrackingController,
): Router {
  const router = Router();
  const linkRateLimit = createIpRateLimit({
    keyPrefix: 'driver-invite-link',
    ...DRIVER_INVITE_LINK_RATE_LIMIT,
  });

  router.get('/driver-invites/open/:token', linkRateLimit, asyncHandler(controller.openInviteLink));
  router.post('/webhooks/msg91/whatsapp', asyncHandler(controller.whatsappReport));

  return router;
}
