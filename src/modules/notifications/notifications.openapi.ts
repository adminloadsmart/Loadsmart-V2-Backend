import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { notificationValidators } from './notifications.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/notifications`; // absolute path — must match its mount in app.ts

export function registerNotificationsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.listNotifications',
    ...authenticated(
      'List the caller’s own notifications, paginated, with an optional unread-only filter. There is no endpoint to create a notification here — sending is done in-process by other services.',
    ),
    request: { query: notificationValidators.list.shape.query },
    responses: { 200: { description: 'Paginated notifications' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{notificationId}`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.getNotification',
    ...authenticated(
      'Full detail of one of the caller’s own notifications, including the per-channel delivery outcome (email/sms/push).',
    ),
    request: { params: notificationValidators.get.shape.params },
    responses: {
      200: { description: 'Notification detail with per-channel delivery status' },
      404: { description: 'Notification not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{notificationId}/read`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.markNotificationRead',
    ...authenticated('Mark one of the caller’s own notifications read. Idempotent.'),
    request: { params: notificationValidators.markRead.shape.params },
    responses: {
      200: { description: 'Notification marked read' },
      404: { description: 'Notification not found', ...errorContent },
    },
  });
}
