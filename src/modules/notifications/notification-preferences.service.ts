import { AuthorizationError, NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import {
  NotificationCategoryOrGeneral,
  NotificationChannelName,
  NotificationSeverity,
} from './notifications.types';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { DEFAULT_QUIET_HOURS } from './notifications.constants';
import {
  ChannelPreferenceFlags,
  MyNotificationPreferenceView,
  QuietHoursSetting,
  UpdateMyNotificationPreferenceInput,
} from './notifications.interface';
import { IN_APP_HIDDEN_TYPES, NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import { categoryOf } from './utils/notification-presenter';
import {
  clampToSupported,
  resolveChannelPreferences,
  supportedChannelsOf,
} from './utils/channel-preferences';

export interface NotificationPreferenceView {
  key: string;
  label: string;
  description: string | null;
  severity: NotificationSeverity;
  category: NotificationCategoryOrGeneral;
  categoryLabel: string;
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

/** Only notifications the code actually sends — a notification_types row whose key is no longer
 *  in the catalog (retired, or not yet removed by a seed run) never reaches the settings screen. */
function isImplementedType(key: string): boolean {
  return key in NOTIFICATION_CATALOG;
}

function assertOrgAdmin(role: string): void {
  if (role !== ORG_ADMIN_ROLE) {
    throw new AuthorizationError('Only an org admin can manage notification preferences');
  }
}

export class NotificationPreferencesService {
  constructor(private readonly repository: NotificationPreferencesRepository) {}

  /** The caller's own Settings → Notifications: every type, with its fixed supported mediums
   *  and the caller's effective on/off (own choice → org setting → type defaults). */
  async getMyPreferences(
    tenantId: string,
    userId: string,
  ): Promise<MyNotificationPreferenceView[]> {
    try {
      const [types, organizationPreferences, userPreferences] = await Promise.all([
        this.repository
          .listTypes()
          .then((types) => types.filter((type) => isImplementedType(type.key))),
        this.repository.listOrganizationPreferences(tenantId),
        this.repository.listUserPreferences(tenantId, userId),
      ]);
      const organizationPreferenceByTypeId = new Map(
        organizationPreferences.map((preference) => [preference.notificationTypeId, preference]),
      );
      const userPreferenceByTypeId = new Map(
        userPreferences.map((preference) => [preference.notificationTypeId, preference]),
      );
      return types.map((type) => {
        const supportedChannels = supportedChannelsOf(
          type.channels,
          !IN_APP_HIDDEN_TYPES.includes(type.key),
        );
        const userPreference = userPreferenceByTypeId.get(type.id) ?? null;
        return {
          key: type.key,
          label: type.label,
          description: type.description,
          severity: type.severity,
          ...categoryOf(type.key),
          supportedChannels,
          preferences: clampToSupported(
            resolveChannelPreferences({
              userPreference,
              organizationPreference: organizationPreferenceByTypeId.get(type.id) ?? null,
              defaultChannels: type.defaultChannels,
            }),
            supportedChannels,
          ),
          isCustomized: userPreference !== null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to fetch notification preferences');
    }
  }

  /** Any org user, for themselves only — never touches another user's or the org's setting.
   *  A medium the type doesn't support is always saved as off, whatever the request says. */
  async updateMyPreferences(
    tenantId: string,
    userId: string,
    items: UpdateMyNotificationPreferenceInput[],
  ): Promise<void> {
    try {
      const currentPreferenceByKey = new Map(
        (await this.getMyPreferences(tenantId, userId)).map((view) => [view.key, view]),
      );
      const upserts = await Promise.all(
        items.map(async (item) => {
          const type = await this.repository.findTypeByKey(item.key);
          const current = currentPreferenceByKey.get(item.key);
          if (!type || !current) throw new NotFoundError(`Unknown notification type "${item.key}"`);
          const requested: ChannelPreferenceFlags = {
            ...item.channels,
            inApp: item.channels.inApp ?? current.preferences.inApp,
          };
          return {
            notificationTypeId: type.id,
            channels: clampToSupported(requested, current.supportedChannels),
          };
        }),
      );
      await this.repository.upsertUserPreferences(tenantId, userId, upserts);
    } catch (error) {
      rethrow(error, 'Failed to update notification preferences');
    }
  }

  /** Drops the caller's own choices — back to the organisation's setting / type defaults. */
  async resetMyPreferences(tenantId: string, userId: string): Promise<void> {
    try {
      await this.repository.deleteUserPreferences(tenantId, userId);
    } catch (error) {
      rethrow(error, 'Failed to reset notification preferences');
    }
  }

  /** The organisation's setting (org_admin) — the starting point for every user who hasn't
   *  customised a type. Read-only for any org member; only org_admin can change it. */
  async getPreferences(tenantId: string): Promise<NotificationPreferenceView[]> {
    try {
      const rows = (await this.repository.listWithPreferencesForTenant(tenantId)).filter(
        ({ type }) => isImplementedType(type.key),
      );
      return rows.map(({ type, preference }) => ({
        key: type.key,
        label: type.label,
        description: type.description,
        severity: type.severity,
        ...categoryOf(type.key),
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
          if (!type || !isImplementedType(type.key)) {
            throw new NotFoundError(`Unknown notification type "${item.key}"`);
          }

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

  /** Any org member can read; DEFAULT_QUIET_HOURS (off) until an org_admin saves one. */
  async getQuietHours(tenantId: string): Promise<QuietHoursSetting> {
    try {
      const row = await this.repository.findQuietHours(tenantId);
      return row
        ? { enabled: row.enabled, startTime: row.startTime, endTime: row.endTime }
        : DEFAULT_QUIET_HOURS;
    } catch (error) {
      rethrow(error, 'Failed to fetch quiet hours');
    }
  }

  async updateQuietHours(
    tenantId: string,
    actorId: string,
    actorRole: string,
    setting: QuietHoursSetting,
  ): Promise<QuietHoursSetting> {
    try {
      assertOrgAdmin(actorRole);
      await this.repository.upsertQuietHours(tenantId, setting, actorId);
      return this.getQuietHours(tenantId);
    } catch (error) {
      rethrow(error, 'Failed to update quiet hours');
    }
  }
}
