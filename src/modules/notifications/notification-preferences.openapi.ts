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
    operationId: 'notifications.getPreferences',
    ...authenticated(
      'Org-wide notification channel preferences ("Choose how your team gets alerted") — every ' +
        'notification type, its available channels, and which of those the caller’s org currently ' +
        'has enabled. In-app delivery is always on and has no toggle. Open to any authenticated ' +
        'org member (read-only).',
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
    path: BASE,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.updatePreferences',
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
    path: `${BASE}/reset`,
    tags: [TAGS.NOTIFICATIONS],
    operationId: 'notifications.resetPreferences',
    ...authenticated(
      'Reset the org’s notification preferences back to each type’s product-intended defaults ' +
        '("Reset to Default"). Org_admin only — any other caller gets 403.',
    ),
    responses: {
      200: { description: 'Preferences reset to defaults, same shape as GET' },
      403: { description: 'Caller is not an org admin', ...errorContent },
    },
  });
}
