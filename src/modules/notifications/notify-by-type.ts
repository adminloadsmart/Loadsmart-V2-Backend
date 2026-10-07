import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { UserEntity } from '../auth/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { NotificationDestinations } from './notifications.interface';
import { NotificationChannelName } from './notifications.types';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { rethrow } from '../../shared/errors';
import { redisManager } from '../../db/redis';
import { NotificationTriggers } from './notification-triggers';
import { DEFAULT_LOCALE, Locale } from '../../shared/i18n/locales';

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
                (Array.isArray(byPermission) ? byPermission : [byPermission]).map((p) =>
                  deps.authRepository.listUsersWithPermission(tenantId, p.permission, p.role),
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

    // One row per (tenant, type) — org-wide, so every recipient in this dispatch shares the same
    // preference (see NotificationPreferencesRepository). No saved row falls back to the type's
    // own defaultChannels (matches notification-preferences.service.ts's getPreferences and
    // "Reset to Default" — a tenant that's never touched settings still gets the product-intended
    // defaults, not silence).
    const notificationType = await deps.notificationPreferencesRepository.findTypeByKey(type);
    if (!notificationType) {
      console.warn(
        `No notification_types row for "${type}" — external channels disabled for this dispatch until it's seeded (see src/db/seed-notification-types.ts)`,
      );
    }
    const preference = notificationType
      ? await deps.notificationPreferencesRepository.findByTenantAndTypeId(
          tenantId,
          notificationType.id,
        )
      : null;
    const enabled = {
      email: preference
        ? preference.emailEnabled
        : (notificationType?.defaultChannels.includes('email') ?? false),
      sms: preference
        ? preference.smsEnabled
        : (notificationType?.defaultChannels.includes('sms') ?? false),
      push: preference
        ? preference.pushEnabled
        : (notificationType?.defaultChannels.includes('push') ?? false),
      whatsapp: preference
        ? preference.whatsappEnabled
        : (notificationType?.defaultChannels.includes('whatsapp') ?? false),
    };

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
        const { title, body, metadata } = definition.buildContent(
          context,
          { id: recipient.id, fullName: recipient.fullName },
          locale,
        );
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

        // No early-return when channels is empty — a recipient with no enabled channel for this
        // type (e.g. no contact info on file, even if the org has the channel turned on) still
        // gets the notification row itself, visible via GET /notifications; see
        // notifications.types.ts's own note that channels: [] means in-app only, not
        // "nothing to do".
        await deps.notificationsService.send(tenantId, {
          recipientUserId: recipient.id,
          type,
          title,
          body,
          channels,
          destinations,
          metadata,
          severity: definition.severity,
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
