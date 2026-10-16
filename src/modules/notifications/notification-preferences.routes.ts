import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { notificationPreferencesValidators } from './notification-preferences.validators';

/**
 * Settings → Notifications.
 *  - `/` — the caller's OWN preferences (any org user, only ever their own): GET renders the
 *    grid, PUT is "Save Changes", POST /reset is "Reset to Default".
 *  - `/organization` — the organisation's setting, the starting point for users who haven't
 *    customised a type: GET for any member, PUT/reset org_admin-only (enforced in the service).
 *  - `/quiet-hours` — organisation quiet hours, same access as `/organization`.
 */
export function createNotificationPreferencesRoutes(
  controller: NotificationPreferencesController,
): Router {
  const router = Router();
  router.use(requireTenant);

  router.get('/', asyncHandler(controller.getMyPreferences));
  router.put(
    '/',
    validate(notificationPreferencesValidators.updateMine),
    asyncHandler(controller.updateMyPreferences),
  );
  router.post('/reset', asyncHandler(controller.resetMyPreferences));

  router.get('/organization', asyncHandler(controller.getPreferences));
  router.put(
    '/organization',
    validate(notificationPreferencesValidators.update),
    asyncHandler(controller.updatePreferences),
  );
  router.post('/organization/reset', asyncHandler(controller.resetToDefault));
  // Org quiet hours — GET for any member, PUT org_admin-only (enforced in the service).
  router.get('/quiet-hours', asyncHandler(controller.getQuietHours));
  router.put(
    '/quiet-hours',
    validate(notificationPreferencesValidators.updateQuietHours),
    asyncHandler(controller.updateQuietHours),
  );

  return router;
}
