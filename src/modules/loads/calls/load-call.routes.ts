import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { LOADSMART_TEAM_PERMISSIONS } from '../../../shared/constants/loadsmart-teams';
import { LoadCallController } from './load-call.controller';
import { loadCallValidators as v } from './load-call.validators';

/** Inside the loads router (/v1/loads) — the shipper's team on its own loads. */
export function createShipperLoadCallRoutes(c: LoadCallController): Router {
  const router = Router();
  router.get('/loads/:loadId/calls', validate(v.listCalls), asyncHandler(c.listShipperCalls));
  router.post('/loads/:loadId/calls', validate(v.logShipperCall), asyncHandler(c.logShipperCall));
  router.get('/calls/reminders', validate(v.myReminders), asyncHandler(c.myReminders));
  router.post(
    '/calls/:callId/reminder-done',
    validate(v.reminderDone),
    asyncHandler(c.reminderDone),
  );
  return router;
}

/** At /v1/loadsmart-ops — any Loadsmart team, on any load. `load-calls`, not `calls`:
 *  staging's ls_call_logs already owns /loadsmart-ops/loads/:loadId/calls. */
export function createLoadsmartLoadCallRoutes(c: LoadCallController): Router {
  const router = Router();
  const anyTeam = requirePermission(...LOADSMART_TEAM_PERMISSIONS);
  router.get(
    '/loads/:loadId/load-calls',
    anyTeam,
    validate(v.listCalls),
    asyncHandler(c.listLoadsmartCalls),
  );
  router.post(
    '/loads/:loadId/load-calls',
    anyTeam,
    validate(v.logLoadsmartCall),
    asyncHandler(c.logLoadsmartCall),
  );
  router.get(
    '/load-calls/reminders',
    anyTeam,
    validate(v.myReminders),
    asyncHandler(c.myReminders),
  );
  router.post(
    '/load-calls/:callId/reminder-done',
    anyTeam,
    validate(v.reminderDone),
    asyncHandler(c.reminderDone),
  );
  return router;
}
