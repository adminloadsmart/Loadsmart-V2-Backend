import { NotificationChannelName } from '../notifications.types';

/**
 * The shape every domain catalog (masters-notifications.catalog.ts, vehicle-notifications.
 * catalog.ts, and later load-notifications.catalog.ts) implements — one entry per notification
 * type. Adding a new notification type is one new catalog entry, not a new producer file; see
 * notify-by-type.ts for the generic dispatcher every trigger site calls against these catalogs.
 */
export interface NotificationTypeDefinition<TContext> {
  /** Organization-scope role names (see shared/constants/roles.ts) to fan this notification out to. */
  recipientRoles: string[];
  /** Requested channels for this type — a recipient only actually gets a channel if they also
   *  have the matching contact info (email/phone/push token); see notify-by-type.ts. */
  channels: NotificationChannelName[];
  buildContent(context: TContext): {
    title: string;
    body: string;
    /** Structured variables forwarded as-is to MSG91-templated channels (e.g. whatsapp) — the
     *  channel never composes message text itself, see channels/whatsapp.channel.ts. */
    metadata?: Record<string, string>;
  };
}
