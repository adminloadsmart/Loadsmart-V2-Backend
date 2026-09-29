import { NotificationChannelName, NotificationSeverity } from '../notifications.types';

export interface NotificationRecipient {
  fullName: string | null;
}

/** Template ids/names are env-sourced and may be unset until provisioned on the MSG91 dashboard —
 *  the channel then fails that delivery with a clear "not configured" error. */
export interface NotificationTemplates {
  /** `variables`: metadata keys in the Meta-approved template's {{1}}, {{2}}... order. */
  whatsapp?: { templateName: string | undefined; variables: string[] };
  /** `variables`: MSG91 Flow template variable name → metadata key. */
  sms?: { templateId: string | undefined; variables: Record<string, string> };
  /** `variables`: MSG91 email template variable name → metadata key. The subject lives in the
   *  MSG91 template itself. */
  email?: { templateId: string | undefined; variables: Record<string, string> };
}

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
  /** P1 Critical / P2 Action / P3 Info — stored on every notification of this type and seeded
   *  into notification_types.severity for the settings screen. */
  severity: NotificationSeverity;
  /** 'once_per_tenant' → notify-by-type.ts skips the whole dispatch if this tenant already has a
   *  notification of this type (e.g. "account approved" must never repeat). Default: 'always'. */
  frequency?: 'always' | 'once_per_tenant';
  /** true → WhatsApp only goes to recipients with users.whatsapp_opt_in === true (not captured
   *  or declined → no WhatsApp; SMS still goes out if the type sends it). Default false: the
   *  type's WhatsApp dispatch ignores opt-in, as it always has. */
  requiresWhatsappOptIn?: boolean;
  /** Per-type MSG91 templates, overriding the channel's env-level default template. Each channel
   *  maps its template's variables from the notification's `metadata` by key; a type with no
   *  entry here keeps each channel's original behavior (see channels/*.channel.ts). */
  templates?: NotificationTemplates;
  /** `recipient` is the user this copy is for — lets a type personalize per recipient (e.g. a
   *  first name) without the trigger site having to look users up itself. */
  buildContent(
    context: TContext,
    recipient: NotificationRecipient,
  ): {
    title: string;
    body: string;
    /** Structured variables forwarded as-is to MSG91-templated channels (e.g. whatsapp) — the
     *  channel never composes message text itself, see channels/whatsapp.channel.ts. */
    metadata?: Record<string, string>;
  };
}
