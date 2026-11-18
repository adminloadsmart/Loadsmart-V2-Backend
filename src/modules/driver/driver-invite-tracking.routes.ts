import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { DriverInviteTrackingController } from './driver-invite-tracking.controller';
import { DRIVER_INVITE_LINK_RATE_LIMIT } from './driver.constants';

/**
 * Public (no login) endpoints behind the driver invite's WhatsApp — mounted in publicRouters, so
 * both paths are under /v1:
 * - GET  /driver-invites/open/:token — the tracked app link in the message.
 * MSG91's delivery reports (POST /webhooks/msg91/whatsapp?token=…) now arrive through the messaging
 * module's webhook, which hands every body to DriverService.recordWhatsAppReports.
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

  return router;
}
