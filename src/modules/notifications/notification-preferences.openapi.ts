import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { notificationPreferencesValidators } from './notification-preferences.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, json, errorContent } from '../../shared/openapi/core';

// Absolute path — must match how notification-preferences.routes.ts is mounted (at '/preferences'
// inside notifications/index.ts's router, itself mounted at BASE in composition-root.ts).
const BASE = `${API_VERSION_PREFIX}/notifications/preferences`;

export function registerNotificationPreferencesOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.getMyPreferences',
    ...authenticated(
      'The caller’s own Settings → Notifications: every notification type with `supportedChannels` ' +
        '(fixed per type; `inApp`, `email`, `sms`, `push`, `whatsapp`), the caller’s effective ' +
        '`preferences` (own choice → organisation setting → type defaults) and `isCustomized`.',
    ),
    responses: { 200: { description: 'Array of the caller’s preference rows' } },
  });
  registry.registerPath({
    method: 'put',
    path: BASE,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.updateMyPreferences',
    ...authenticated(
      'Save the caller’s own mediums for one or more types. Any org user; never changes anyone ' +
        'else’s or the organisation’s setting. A medium the type doesn’t support is always saved as ' +
        'off. `inApp` omitted = unchanged. Turning every medium off stops the notification entirely ' +
        'for this user.',
    ),
    request: { body: json(notificationPreferencesValidators.updateMine.shape.body) },
    responses: {
      200: { description: 'The caller’s updated preferences, same shape as GET' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Unknown notification type key', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/reset`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.resetMyPreferences',
    ...authenticated(
      'Drop the caller’s own choices — back to the organisation’s setting / type defaults.',
    ),
    responses: { 200: { description: 'The caller’s preferences, same shape as GET' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organization`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.getOrganizationPreferences',
    ...authenticated(
      'The organisation’s notification channel setting — the starting point for every user who ' +
        'hasn’t customised a type themselves. Every notification type, its available channels, ' +
        'and which the org has enabled. Open to any authenticated org member (read-only).',
    ),
    responses: {
      200: {
        description:
          'Array of { key, label, description, supportedChannels, preferences: { email, sms, push, whatsapp } }',
      },
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${BASE}/organization`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.updateOrganizationPreferences',
    ...authenticated(
      'Bulk-save the org’s channel preferences for one or more notification types ("Save ' +
        'Changes"). Org_admin only — any other caller gets 403. A channel not supported by a given ' +
        'type is silently clamped to disabled server-side, regardless of what’s sent.',
    ),
    request: { body: json(notificationPreferencesValidators.update.shape.body) },
    responses: {
      200: { description: 'Updated preferences, same shape as GET' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Caller is not an org admin', ...errorContent },
      404: {
        description: 'One of the given notification type keys does not exist',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organization/reset`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.resetOrganizationPreferences',
    ...authenticated(
      'Reset the org’s notification preferences back to each type’s product-intended defaults ' +
        '("Reset to Default"). Org_admin only — any other caller gets 403.',
    ),
    responses: {
      200: { description: 'Preferences reset to defaults, same shape as GET' },
      403: { description: 'Caller is not an org admin', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/quiet-hours`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.getQuietHours',
    ...authenticated(
      'The org’s quiet hours `{ enabled, startTime, endTime }` (24-hour HH:MM, India time). ' +
        'During the window push/SMS/WhatsApp are held until it ends; in-app and email still go ' +
        'out, and P1 Critical bypasses it. Off (22:00–07:00) until an org admin saves one.',
    ),
    responses: { 200: { description: 'Quiet hours' } },
  });
  registry.registerPath({
    method: 'put',
    path: `${BASE}/quiet-hours`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.updateQuietHours',
    ...authenticated('Save the org’s quiet hours. Org_admin only — any other caller gets 403.'),
    request: { body: json(notificationPreferencesValidators.updateQuietHours.shape.body) },
    responses: {
      200: { description: 'Saved quiet hours, same shape as GET' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Caller is not an org admin', ...errorContent },
    },
  });
}
