import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { NOTIFICATION_PREFERENCES_MANAGE } from '../../shared/constants/permissions';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { notificationPreferencesValidators } from './notification-preferences.validators';

/**
 * Settings → Notifications.
 *  - `/` — the caller's OWN preferences (any org user, only ever their own): GET renders the
 *    grid, PUT is "Save Changes", POST /reset is "Reset to Default".
 *  - `/organization` — the organisation's setting, the starting point for users who haven't
 *    customised a type: GET for any member, PUT/reset need NOTIFICATION_PREFERENCES_MANAGE.
 *  - `/quiet-hours` — organisation quiet hours, same access as `/organization`.
 */
export function createNotificationPreferencesRoutes(
  controller: NotificationPreferencesController,
): Router {
  const router = Router();
  router.use(requireTenant);
  const canManage = requirePermission(NOTIFICATION_PREFERENCES_MANAGE);

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
    canManage,
    validate(notificationPreferencesValidators.update),
    asyncHandler(controller.updatePreferences),
  );
  router.post('/organization/reset', canManage, asyncHandler(controller.resetToDefault));
  // Org quiet hours — GET for any member, PUT needs NOTIFICATION_PREFERENCES_MANAGE.
  router.get('/quiet-hours', asyncHandler(controller.getQuietHours));
  router.put(
    '/quiet-hours',
    canManage,
    validate(notificationPreferencesValidators.updateQuietHours),
    asyncHandler(controller.updateQuietHours),
  );

  return router;
}
