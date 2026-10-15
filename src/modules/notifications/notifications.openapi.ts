import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { notificationValidators } from './notifications.validators';
import { registerNotificationPreferencesOpenApi } from './notification-preferences.openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/notifications`; // absolute path — must match its mount in app.ts

/** Delegates the /preferences sub-resource to its own file (same aggregation style
 *  masters.openapi.ts uses for its submodules) — no separate call needed in docs.ts, it's reached
 *  transitively through this function. */
export function registerNotificationsOpenApi(registry: OpenAPIRegistry): void {
  registerNotificationPreferencesOpenApi(registry);

  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.listNotifications',
    ...authenticated(
      'List the caller’s own notifications, paginated, with optional unread-only and severity filters. Each item carries `severity` (`p1_critical` / `p2_action` / `p3_info` / `p4_digest`). Only the newest daily brief (`digest.daily_brief`) is included; older ones are left out of the list and `total`. Every item also carries `category`/`categoryLabel`, `ctaStyle` and `bypassesQuietHours`, and the response includes `unreadCount` for the bell badge. There is no endpoint to create a notification here — sending is done in-process by other services.',
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
      'Full detail of one of the caller’s own notifications, including its `severity` and the per-channel delivery outcome (email/sms/push/whatsapp).',
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
  registry.registerPath({
    method: 'post',
    path: `${BASE}/mark-all-read`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.markAllNotificationsRead',
    ...authenticated(
      'Mark all of the caller’s own unread notifications (in their current organization) read. No body. Returns `{ markedCount }`.',
    ),
    responses: { 200: { description: 'Number of notifications marked read' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/channel-status`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.channelStatus',
    ...authenticated(
      'Which delivery gateways this server is configured for: `{ inApp, push, sms, whatsapp, email }` booleans — for the inbox header ("WhatsApp, SMS & Push gateways active").',
    ),
    responses: { 200: { description: 'Gateway status' } },
  });
}
