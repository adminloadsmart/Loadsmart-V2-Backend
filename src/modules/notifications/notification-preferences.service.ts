import { AuthorizationError, NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { NotificationChannelName } from './notifications.types';
import { NotificationPreferencesRepository } from './notification-preferences.repository';

export interface NotificationPreferenceView {
  key: string;
  label: string;
  description: string | null;
  supportedChannels: NotificationChannelName[];
  preferences: { email: boolean; sms: boolean; push: boolean; whatsapp: boolean };
}

export interface UpdateNotificationPreferenceInput {
  key: string;
  channels: { email: boolean; sms: boolean; push: boolean; whatsapp: boolean };
}

function toChannelFlags(channels: NotificationChannelName[]): {
  email: boolean;
  sms: boolean;
  push: boolean;
  whatsapp: boolean;
} {
  const set = new Set<string>(channels);
  return {
    email: set.has('email'),
    sms: set.has('sms'),
    push: set.has('push'),
    whatsapp: set.has('whatsapp'),
  };
}

function assertOrgAdmin(role: string): void {
  if (role !== ORG_ADMIN_ROLE) {
    throw new AuthorizationError('Only an org admin can manage notification preferences');
  }
}

export class NotificationPreferencesService {
  constructor(private readonly repository: NotificationPreferencesRepository) {}

  /** Read-only — any authenticated org member can see how their team is configured to be
   *  alerted; only org_admin can change it (see updatePreferences/resetToDefault). */
  async getPreferences(tenantId: string): Promise<NotificationPreferenceView[]> {
    try {
      const rows = await this.repository.listWithPreferencesForTenant(tenantId);
      return rows.map(({ type, preference }) => ({
        key: type.key,
        label: type.label,
        description: type.description,
        supportedChannels: type.channels,
        preferences: preference
          ? {
              email: preference.emailEnabled,
              sms: preference.smsEnabled,
              push: preference.pushEnabled,
              whatsapp: preference.whatsappEnabled,
            }
          : toChannelFlags(type.defaultChannels),
      }));
    } catch (error) {
      rethrow(error, 'Failed to fetch notification preferences');
    }
  }

  /** Org-admin only ("Choose how your team gets alerted" — org-wide, not personal). Clamps any
   *  channel not in a type's own supported-channels list back to false — the settings UI already
   *  grays these out, but the backend doesn't trust that: an unsupported channel can never
   *  actually be persisted as enabled, whatever the request body says. */
  async updatePreferences(
    tenantId: string,
    actorRole: string,
    items: UpdateNotificationPreferenceInput[],
  ): Promise<void> {
    try {
      assertOrgAdmin(actorRole);

      const upserts = await Promise.all(
        items.map(async (item) => {
          const type = await this.repository.findTypeByKey(item.key);
          if (!type) throw new NotFoundError(`Unknown notification type "${item.key}"`);

          const supported = new Set<string>(type.channels);
          return {
            notificationTypeId: type.id,
            email: supported.has('email') && item.channels.email,
            sms: supported.has('sms') && item.channels.sms,
            push: supported.has('push') && item.channels.push,
            whatsapp: supported.has('whatsapp') && item.channels.whatsapp,
          };
        }),
      );

      await this.repository.upsertPreferences(tenantId, upserts);
    } catch (error) {
      rethrow(error, 'Failed to update notification preferences');
    }
  }

  async resetToDefault(tenantId: string, actorRole: string): Promise<void> {
    try {
      assertOrgAdmin(actorRole);
      await this.repository.resetToDefault(tenantId);
    } catch (error) {
      rethrow(error, 'Failed to reset notification preferences');
    }
  }
}
