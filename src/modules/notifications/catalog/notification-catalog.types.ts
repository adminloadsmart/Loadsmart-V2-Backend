import type { Locale } from '../../../shared/i18n/locales';
import { NotificationChannelName, NotificationSeverity } from '../notifications.types';

export interface NotificationRecipient {
  /** The recipient's user id — lets a type vary copy by who is reading (e.g. LS_N_0055 shows the
   *  repair cost only to users who can see maintenance costs). */
  id?: string;
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
  /** For a notification about one specific person (e.g. the invited teammate, or the user whose
   *  access changed): that user's id, read from the context. When set, it replaces the
   *  recipientRoles fan-out — only that user (in this tenant, not deleted) is notified. Method
   *  syntax for the same bivariance reason as dedupeKey. */
  recipientUserId?(context: TContext): string;
  /** Recipients = this tenant's users who hold `permission` (via role or a direct grant) and, if
   *  given, have `role` — e.g. whoever can approve a master record. Replaces the recipientRoles
   *  fan-out (recipientUserId wins if both are set). Method syntax, like dedupeKey. */
  recipientPermission?(
    context: TContext,
  ): { permission: string; role?: string } | { permission: string; role?: string }[];
  /** Roles left out of the recipientPermission audience for this dispatch — e.g. LS_N_0057 keeps
   *  org admins (who hold maintenance.manage via their role) out until it escalates; roles listed
   *  in recipientRoles/extraRecipientRoles are still added. Method syntax, like dedupeKey. */
  excludeRolesFromPermission?(context: TContext): string[];
  /** A user never notified by this dispatch — e.g. the creator of the record being approved. */
  excludeUserId?(context: TContext): string | null | undefined;
  /** Roles added to recipientRoles for this particular dispatch — e.g. LS_N_0049 brings org
   *  admins in only when escalating. Method syntax, like dedupeKey. */
  extraRecipientRoles?(context: TContext): string[];
  /** One extra specific user notified alongside a recipientPermission/recipientRoles audience
   *  (same tenant, not deleted, never twice) — e.g. LS_N_0012's "the user who added it, plus
   *  holders of compliance.manage". */
  alsoNotifyUserId?(context: TContext): string | null | undefined;
  /** Per-recipient cap: once a recipient has had `max` of this type within `windowSeconds`, they
   *  stop getting individual ones for the rest of that window; each extra one instead triggers
   *  `overflowType` (a debounced summary) for that recipient — LS_N_0009's "more than 3 in an
   *  hour, collapse into one message". */
  recipientRateLimit?: { max: number; windowSeconds: number; overflowType: string };
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
  /** false → the notification row is still stored (delivery tracking, once_per_tenant) but never
   *  shown in the app: GET /notifications omits it and GET/PATCH /notifications/:id 404 it — for
   *  types whose recipient has no app access yet (e.g. LS_N_0002). Default true. */
  inApp?: boolean;
  /** Identifies one occurrence of the event (e.g. a document id) for the trigger queue (see
   *  notification-triggers.ts): near-simultaneous triggers with the same key collapse into one
   *  job, and it keys this type's reminder job so a repeat trigger replaces a pending reminder
   *  instead of stacking another. once_per_tenant types key by tenant without needing this. */
  // Method syntax (like buildContent below), not a function-typed property: keeps this
  // parameter bivariant, so a catalog with a context-specific dedupeKey still satisfies
  // NotifyByType's `Record<string, NotificationTypeDefinition<unknown>>` constraint.
  dedupeKey?(context: TContext): string;
  /** "Throttle and escalation": send exactly one reminder this long after the notification, then
   *  stop — only if the trigger worker's relevance check for this type (if any) still passes at
   *  that time. Reminders are ordinary notifications of the same type with `isReminder: true`
   *  merged into their context. */
  reminderAfterMs?: number;
  /** With reminderAfterMs: whether THIS send should get a reminder (default yes) — e.g. an
   *  escalation message isn't itself reminded. */
  shouldRemind?(context: TContext): boolean;
  /** Batch a burst of triggers for the same occurrence (dedupeKey) into ONE notification sent
   *  this long after the last of them — e.g. an admin toggling several capabilities one call at
   *  a time. Each new trigger restarts the wait and replaces the queued payload. */
  debounceMs?: number;
  /** Send this long after the FIRST trigger for the occurrence (dedupeKey); repeat triggers while
   *  it's waiting don't restart the clock (unlike debounceMs) — e.g. LS_N_0012's "retry over 24
   *  hours before notifying". A relevance check then decides at send time if it's still needed. */
  delayMs?: number;
  /** Per-type MSG91 templates, overriding the channel's env-level default template. Each channel
   *  maps its template's variables from the notification's `metadata` by key; a type with no
   *  entry here keeps each channel's original behavior (see channels/*.channel.ts). */
  templates?: NotificationTemplates;
  /** `recipient` is the user this copy is for — lets a type personalize per recipient (e.g. a
   *  first name) without the trigger site having to look users up itself. */
  buildContent(
    context: TContext,
    recipient: NotificationRecipient,
    /** The recipient-facing language; omitted means English. */
    locale?: Locale,
  ): {
    title: string;
    body: string;
    /** Structured variables forwarded as-is to MSG91-templated channels (e.g. whatsapp) — the
     *  channel never composes message text itself, see channels/whatsapp.channel.ts. */
    metadata?: Record<string, string>;
  };
}
