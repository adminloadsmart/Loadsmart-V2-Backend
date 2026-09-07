import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { NotificationsController } from './notifications.controller';
import { notificationValidators } from './notifications.validators';

/**
 * Read-only, self-service surface — every route here acts on the caller's own notifications
 * (recipientUserId = req.user.id), so none needs a permission beyond auth + tenant scope.
 * Sending a notification (NotificationsService.send) has no HTTP route at all — see the
 * module's plan notes.
 */
export function createNotificationsRoutes(controller: NotificationsController): Router {
  const router = Router();
  router.use(requireTenant);

  router.get(
    '/',
    validate(notificationValidators.list),
    asyncHandler(controller.listNotifications),
  );
  router.get(
    '/:notificationId',
    validate(notificationValidators.get),
    asyncHandler(controller.getNotification),
  );
  router.patch(
    '/:notificationId/read',
    validate(notificationValidators.markRead),
    asyncHandler(controller.markNotificationRead),
  );

  return router;
}
