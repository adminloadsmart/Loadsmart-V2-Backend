import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { notificationPreferencesValidators } from './notification-preferences.validators';

/**
 * Org-wide surface (acts on the caller's tenant, not req.user.id — "Choose how your team gets
 * alerted") — the settings screen this backs: GET renders the grid, PUT is "Save Changes", POST
 * /reset is "Reset to Default". PUT/reset are org_admin-only (enforced in the service); GET is
 * open to any authenticated org member.
 */
export function createNotificationPreferencesRoutes(
  controller: NotificationPreferencesController,
): Router {
  const router = Router();
  router.use(requireTenant);

  router.get('/', asyncHandler(controller.getPreferences));
  router.put(
    '/',
    validate(notificationPreferencesValidators.update),
    asyncHandler(controller.updatePreferences),
  );
  router.post('/reset', asyncHandler(controller.resetToDefault));

  return router;
}
