import { NotificationChannelName } from '../notifications.types';

/**
 * The shape every domain catalog (masters-notifications.catalog.ts, vehicle-notifications.
 * catalog.ts, and later load-notifications.catalog.ts) implements — one entry per notification
 * type. Adding a new notification type is one new catalog entry, not a new producer file; see
 * notify-by-type.ts for the generic dispatcher every trigger site calls against these catalogs.
 */
export interface NotificationTypeDefinition<TContext> {
  /** Settings-screen row name for this notification type, e.g. "Vehicle compliance expiring
   *  soon" — seeded verbatim into the notification_types.label column (see
   *  src/db/seed-notification-types.ts), which is what the preferences UI actually reads. */
  label: string;
  /** Optional subtext under the label on the settings screen. */
  description?: string;
  /** Organization-scope role names (see shared/constants/roles.ts) to fan this notification out to. */
  recipientRoles: string[];
  /** Every channel this type could ever use — seeded into notification_types.channels. Currently
   *  every type lists all four (nothing is grayed out in the settings UI); kept as its own field
   *  rather than removed so a future type CAN restrict itself again without a schema change. A
   *  recipient only actually gets a channel if they ALSO (a) have the matching contact info and
   *  (b) have it enabled — via a saved org preference, or defaultChannels below if none is saved
   *  yet; see notify-by-type.ts. */
  channels: NotificationChannelName[];
  /** Which of `channels` are ON out of the box, before an org_admin has ever saved a preference
   *  for this type — seeded into notification_types.default_channels. Matches the settings-screen
   *  mockup's shown toggle states per row. "Reset to Default" (notification-preferences.service.ts)
   *  puts a tenant back to exactly this. */
  defaultChannels: NotificationChannelName[];
  buildContent(context: TContext): {
    title: string;
    body: string;
    /** Structured variables forwarded as-is to MSG91-templated channels (e.g. whatsapp) — the
     *  channel never composes message text itself, see channels/whatsapp.channel.ts. */
    metadata?: Record<string, string>;
  };
}
