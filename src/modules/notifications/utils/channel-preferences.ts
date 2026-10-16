import { NotificationPreferenceEntity } from '../entities/notification-preference.entity';
import { UserNotificationPreferenceEntity } from '../entities/user-notification-preference.entity';
import { NotificationChannelName, NotificationPreferenceChannel } from '../notifications.types';
import { ChannelPreferenceFlags } from '../notifications.interface';

/**
 * A user's effective mediums for one notification type, most specific first:
 *  1. the user's own saved choice (Settings → Notifications);
 *  2. else the organisation's setting saved by an org_admin (in-app on);
 *  3. else the type's defaultChannels (in-app on).
 * Never enables a medium the type doesn't support — callers clamp with supportedChannelsOf.
 */
export function resolveChannelPreferences(params: {
  userPreference: UserNotificationPreferenceEntity | null;
  organizationPreference: NotificationPreferenceEntity | null;
  defaultChannels: NotificationChannelName[];
}): ChannelPreferenceFlags {
  const { userPreference, organizationPreference, defaultChannels } = params;
  if (userPreference) {
    return {
      inApp: userPreference.inAppEnabled,
      email: userPreference.emailEnabled,
      sms: userPreference.smsEnabled,
      push: userPreference.pushEnabled,
      whatsapp: userPreference.whatsappEnabled,
    };
  }
  if (organizationPreference) {
    return {
      inApp: true,
      email: organizationPreference.emailEnabled,
      sms: organizationPreference.smsEnabled,
      push: organizationPreference.pushEnabled,
      whatsapp: organizationPreference.whatsappEnabled,
    };
  }
  return {
    inApp: true,
    email: defaultChannels.includes('email'),
    sms: defaultChannels.includes('sms'),
    push: defaultChannels.includes('push'),
    whatsapp: defaultChannels.includes('whatsapp'),
  };
}

/** The mediums a type supports: its fixed catalog channels, plus in-app unless the type is never
 *  shown in the app (catalog `inApp: false`). */
export function supportedChannelsOf(
  channels: NotificationChannelName[],
  isShownInApp: boolean,
): NotificationPreferenceChannel[] {
  return isShownInApp ? ['inApp', ...channels] : [...channels];
}

/** Forces every medium the type doesn't support to off. */
export function clampToSupported(
  flags: ChannelPreferenceFlags,
  supportedChannels: NotificationPreferenceChannel[],
): ChannelPreferenceFlags {
  const isSupported = (channel: NotificationPreferenceChannel) =>
    supportedChannels.includes(channel);
  return {
    inApp: isSupported('inApp') && flags.inApp,
    email: isSupported('email') && flags.email,
    sms: isSupported('sms') && flags.sms,
    push: isSupported('push') && flags.push,
    whatsapp: isSupported('whatsapp') && flags.whatsapp,
  };
}
