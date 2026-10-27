import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { UserEntity } from '../auth/entities/user.entity';
import { NotificationsService } from './notifications.service';
import {
  ChannelPreferenceFlags,
  NotificationDestinations,
  NotificationTriggers,
} from './notifications.interface';
import { NotificationChannelName } from './notifications.types';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { rethrow } from '../../shared/errors';
import { redisManager } from '../../db/redis';
import { DEFAULT_LOCALE, Locale } from '../../shared/i18n/locales';
import { QUIET_HOURS_HELD_CHANNELS } from './notifications.constants';
import { getQuietHoursDelayMs } from './utils/quiet-hours';
import { resolveChannelPreferences } from './utils/channel-preferences';

export interface NotifyByTypeDeps {
  notificationsService: NotificationsService;
  authRepository: AuthRepository; // role-based recipient lookup
  authService: AuthService; // getActiveDeviceTokensForUser, for the 'push' channel
  notificationPreferencesRepository: NotificationPreferencesRepository; // org-wide channel opt-in
  // For catalog types with recipientRateLimit — queues the overflow summary. Optional so callers
  // without it (no rate-limited types) are unaffected.
  notificationTriggers?: NotificationTriggers;
}

/**
 * Generic over the *specific* catalog object `C` and the *specific* key `K` passed at the call
 * site — not just `Record<string, NotificationTypeDefinition<any>>` — so TypeScript resolves
 * `context`'s required shape per call from `C[K]`'s own `buildContent` parameter, the same way it
 * would if each notification type still lived in its own separately-typed catalog file. Passing
 * `NOTIFICATION_CATALOG` and the literal key `'vehicle.compliance_expired'` requires `context` to
 * be exactly `VehicleDocumentExpiredContext`; passing a mismatched context for that key is a compile
 * error, same as passing `'some.unknown.key'` not present in the catalog at all.
 */
export interface NotifyByType {
  <C extends Record<string, NotificationTypeDefinition<unknown>>, K extends keyof C>(
    catalog: C,
    type: K,
    tenantId: string,
    context: C[K] extends NotificationTypeDefinition<infer TContext> ? TContext : never,
    locale?: Locale,
  ): Promise<void>;
}

/**
 * The one dispatcher every trigger site calls against a domain catalog (vehicle-notifications.
 * catalog.ts today, more domain catalogs later) — resolves recipients by role, builds content, and
 * picks a channel+destination per recipient based on three things all having to hold: the catalog
 * declares the channel, the recipient has the matching contact info, and the recipient's org has
 * that channel enabled — either a saved org-wide notification-preferences row ("Choose how your
 * team gets alerted"), or, if the org has never saved one, the notification type's own
 * defaultChannels (see notification-catalog.ts and NotificationPreferencesRepository).
 *
 * A dispatch failure is rethrown, not swallowed: the current (and so far only) caller is
 * notification-trigger.worker.ts's BullMQ job handler, which relies on the throw propagating
 * so a transient failure (e.g. Redis/DB hiccup) retries per the queue's defaultJobOptions instead
 * of silently dropping the alert. A future caller invoked directly from a request path (not via a
 * queue) must wrap its own call in try/catch if it wants best-effort, fire-and-forget semantics —
 * see admin.service.ts's notifyAccountApproved for that pattern.
 *
 * Implemented with loose internal typing deliberately: TypeScript can't resolve a conditional
 * type depending on its own not-yet-instantiated generic parameters (`C`/`K`, see `NotifyByType`
 * above) from inside a function body — only at each external call site once `C`/`K` are known.
 * That's a standard, well-known limitation for a "precisely-typed public signature, pragmatic
 * internal body" pattern. The looseness is confined to this one function and never leaks to a
 * caller — createNotifyByType casts this implementation to the checked `NotifyByType` signature
 * on the way out, which is the real (enforced) boundary.
 */
async function notifyByTypeImpl(
  deps: NotifyByTypeDeps,
  catalog: Record<string, NotificationTypeDefinition<unknown>>,
  type: string,
  tenantId: string,
  context: unknown,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const definition = catalog[type];
  try {
    if (
      definition.frequency === 'once_per_tenant' &&
      (await deps.notificationsService.hasNotificationOfType(tenantId, type))
    ) {
      return;
    }

    const targetUserId = definition.recipientUserId?.(context);
    const byPermission = definition.recipientPermission?.(context);
    const excludedUserId = definition.excludeUserId?.(context);
    const alsoNotifyUserId = definition.alsoNotifyUserId?.(context);
    const excludedPermissionRoles = definition.excludeRolesFromPermission?.(context) ?? [];
    const roles = [
      ...definition.recipientRoles,
      ...(definition.extraRecipientRoles?.(context) ?? []),
    ];
    const audience = (
      targetUserId
        ? await findTenantUser(deps.authRepository, tenantId, targetUserId)
        : byPermission
          ? // Holders of ANY of the listed permissions, plus anyone in recipientRoles (e.g.
            // LS_N_0048: compliance.manage + dispatch.planning.manage holders + org admins).
            (
              await Promise.all(
                (Array.isArray(byPermission) ? byPermission : [byPermission]).map((holder) =>
                  deps.authRepository.listUsersWithPermission(
                    tenantId,
                    holder.permission,
                    holder.role,
                  ),
                ),
              )
            )
              .flat()
              .filter((user) => !excludedPermissionRoles.includes(user.role?.name))
              .concat(
                roles.length ? await deps.authRepository.listUsersByRole(tenantId, roles) : [],
              )
          : await deps.authRepository.listUsersByRole(tenantId, roles)
    ).concat(
      alsoNotifyUserId ? await findTenantUser(deps.authRepository, tenantId, alsoNotifyUserId) : [],
    );
    const recipients = audience.filter(
      (recipient, index) =>
        recipient.id !== excludedUserId &&
        audience.findIndex((other) => other.id === recipient.id) === index,
    );

    // Each recipient's own mediums for this type (Settings → Notifications): their saved row, else
    // the org_admin's setting, else the type's defaultChannels — see utils/channel-preferences.ts.
    // Loaded once per dispatch (one query for every recipient's own row).
    const notificationType = await deps.notificationPreferencesRepository.findTypeByKey(type);
    if (!notificationType) {
      console.warn(
        `No notification_types row for "${type}" — external channels disabled for this dispatch until it's seeded (see src/db/seed-notification-types.ts)`,
      );
    }
    const organizationPreference = notificationType
      ? await deps.notificationPreferencesRepository.findByTenantAndTypeId(
          tenantId,
          notificationType.id,
        )
      : null;
    const userPreferenceByUserId = new Map(
      (notificationType
        ? await deps.notificationPreferencesRepository.listUserPreferencesForType(
            tenantId,
            notificationType.id,
            recipients.map((recipient) => recipient.id),
          )
        : []
      ).map((userPreference) => [userPreference.userId, userPreference]),
    );
    const isShownInApp = definition.inApp !== false;
    const channelPreferencesOf = (recipientId: string): ChannelPreferenceFlags =>
      notificationType
        ? resolveChannelPreferences({
            userPreference: userPreferenceByUserId.get(recipientId) ?? null,
            organizationPreference,
            defaultChannels: notificationType.defaultChannels,
          })
        : { inApp: true, email: false, sms: false, push: false, whatsapp: false };
    // Org quiet hours: hold push/SMS/WhatsApp until the window ends (P1 bypasses — see
    // quiet-hours.ts). Worked out once per dispatch, like the preference row above.
    const quietHoursDelayMs = getQuietHoursDelayMs(
      await deps.notificationPreferencesRepository.findQuietHours(tenantId),
      definition.severity,
    );
    const channelDelaysMs = quietHoursDelayMs
      ? Object.fromEntries(QUIET_HOURS_HELD_CHANNELS.map((channel) => [channel, quietHoursDelayMs]))
      : undefined;
    // When this occurrence's one reminder/escalation is due (if the type schedules one) — lets
    // the card show "escalates in 1h 40m". Mirrors the trigger worker's scheduling rule.
    const isReminder = (context as { isReminder?: boolean } | null)?.isReminder === true;
    const followUpAt =
      definition.reminderAfterMs && !isReminder && (definition.shouldRemind?.(context) ?? true)
        ? new Date(Date.now() + definition.reminderAfterMs).toISOString()
        : undefined;

    await Promise.all(
      recipients.map(async (recipient) => {
        const limit = definition.recipientRateLimit;
        if (
          limit &&
          (await isOverRecipientLimit(type, recipient.id, limit.max, limit.windowSeconds))
        ) {
          // Over this recipient's cap for the window: no individual notification — queue the
          // (debounced) summary instead, so they get one "N waiting" message.
          await deps.notificationTriggers?.enqueue(limit.overflowType as never, tenantId, {
            userId: recipient.id,
          } as never);
          return;
        }
        const { title, body, metadata, highlights } = definition.buildContent(
          context,
          { id: recipient.id, fullName: recipient.fullName },
          locale,
        );
        const enabled = channelPreferencesOf(recipient.id);
        const channels: NotificationChannelName[] = [];
        const destinations: NotificationDestinations = {};

        if (definition.channels.includes('email') && recipient.email && enabled.email) {
          channels.push('email');
          destinations.email = recipient.email;
        }
        // SMS needs a per-type DLT-approved template (India's DLT rules register exact message
        // text), so only types declaring `templates.sms` are texted — the generic env template
        // was never real, and before this no type was dispatched over SMS at all.
        if (
          definition.channels.includes('sms') &&
          definition.templates?.sms &&
          recipient.phoneNumber &&
          enabled.sms
        ) {
          channels.push('sms');
          destinations.phoneNumber = recipient.phoneNumber;
        }
        // Types with requiresWhatsappOptIn only WhatsApp recipients who opted in
        // (users.whatsapp_opt_in — captured at signup or at first login); null (never captured)
        // or false → no WhatsApp, SMS only. Other types are unaffected by opt-in.
        if (
          definition.channels.includes('whatsapp') &&
          recipient.phoneNumber &&
          (!definition.requiresWhatsappOptIn || recipient.whatsappOptIn === true) &&
          enabled.whatsapp
        ) {
          channels.push('whatsapp');
          destinations.whatsappNumber = recipient.phoneNumber;
        }
        if (definition.channels.includes('push') && enabled.push) {
          // Picks a single active device token per recipient rather than fanning out to every
          // device (dispatch-planning.service.ts's notifyAssignedDrivers fans out per driver
          // session instead) — a deliberate simplification for this first batch of producers.
          const [session] = await deps.authService.getActiveDeviceTokensForUser(recipient.id);
          if (session?.fcmToken) {
            channels.push('push');
            destinations.pushToken = session.fcmToken;
          }
        }

        // The recipient turned in-app off and no other medium is going out — they get nothing at
        // all for this type ("turning an alert off stops it on every channel"). Types never shown
        // in the app (inApp: false) keep their row as before: it carries delivery tracking and
        // once_per_tenant.
        if (isShownInApp && !enabled.inApp && channels.length === 0) return;

        // Otherwise no early-return when channels is empty — a recipient with in-app on but no
        // other enabled channel (e.g. no contact info on file) still gets the notification row
        // itself, visible via GET /notifications; see notifications.types.ts's own note that
        // channels: [] means in-app only, not "nothing to do".
        await deps.notificationsService.send(tenantId, {
          recipientUserId: recipient.id,
          type,
          title,
          body,
          channels,
          destinations,
          // Unchanged when there's nothing to add — a type without metadata still stores null.
          metadata:
            highlights?.length || followUpAt
              ? {
                  ...metadata,
                  ...(highlights?.length ? { highlights } : {}),
                  ...(followUpAt ? { follow_up_at: followUpAt } : {}),
                }
              : metadata,
          severity: definition.severity,
          channelDelaysMs,
          // In-app off → the row exists only to carry the other mediums; hidden from the inbox.
          showInApp: isShownInApp ? enabled.inApp : true,
        });
      }),
    );
  } catch (error) {
    rethrow(error, `Failed to notify by type ${type} for tenant ${tenantId}`);
  }
}

/** Counts this recipient's notifications of this type in a fixed window (see recipientRateLimit). */
async function isOverRecipientLimit(
  type: string,
  userId: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const count = await redisManager.incrInFixedWindow(
    `notifications:recipient-limit:${type}:${userId}`,
    windowSeconds,
  );
  return count > max;
}

/** A single named recipient — only if they still exist (not deleted) and belong to this tenant,
 *  so a context can never direct a notification into another tenant. */
async function findTenantUser(
  authRepository: AuthRepository,
  tenantId: string,
  userId: string,
): Promise<UserEntity[]> {
  const user = await authRepository.findUserById(userId);
  return user && user.tenantId === tenantId ? [user] : [];
}

/**
 * The typed factory every composition-root caller uses — the cast here is the one place this
 * module trusts `notifyByTypeImpl`'s internals; every actual call site (e.g.
 * notification-trigger.worker.ts) goes through the precise `NotifyByType` signature above
 * and gets full compile-time checking of `type`/`context` against whatever catalog it passes.
 */
export function createNotifyByType(deps: NotifyByTypeDeps): NotifyByType {
  const notifyByType = (
    catalog: Record<string, NotificationTypeDefinition<unknown>>,
    type: string,
    tenantId: string,
    context: unknown,
    locale?: Locale,
  ): Promise<void> => notifyByTypeImpl(deps, catalog, type, tenantId, context, locale);
  return notifyByType as NotifyByType;
}
