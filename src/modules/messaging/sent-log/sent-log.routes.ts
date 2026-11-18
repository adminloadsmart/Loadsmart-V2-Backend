import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { LOADSMART_TEAM_PERMISSIONS } from '../../../shared/constants/loadsmart-teams';
import { SentLogController } from './sent-log.controller';
import { sentLogValidators as v } from './sent-log.validators';

/** Mounted inside the loads router (/v1/loads) — the shipper's own load. */
export function createShipperSentLogRoutes(controller: SentLogController): Router {
  const router = Router();
  router.get(
    '/loads/:loadId/messages',
    validate(v.loadMessages),
    asyncHandler(controller.shipperMessages),
  );
  return router;
}

/** Mounted at /v1/loadsmart-ops — any Loadsmart team. */
export function createOpsSentLogRoutes(controller: SentLogController): Router {
  const router = Router();
  const anyTeam = requirePermission(...LOADSMART_TEAM_PERMISSIONS);
  router.get(
    '/loads/:loadId/messages',
    anyTeam,
    validate(v.loadMessages),
    asyncHandler(controller.adminMessages),
  );
  router.get(
    '/loads/:loadId/whatsapp',
    anyTeam,
    validate(v.loadMessages),
    asyncHandler(controller.whatsappLog),
  );
  return router;
}
