import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { NotificationDestinations } from './notifications.interface';
import { NotificationChannelName } from './notifications.types';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { rethrow } from '../../shared/errors';

export interface NotifyByTypeDeps {
  notificationsService: NotificationsService;
  authRepository: AuthRepository; // role-based recipient lookup
  authService: AuthService; // getActiveDeviceTokensForUser, for the 'push' channel
  notificationPreferencesRepository: NotificationPreferencesRepository; // org-wide channel opt-in
}

/**
 * Generic over the *specific* catalog object `C` and the *specific* key `K` passed at the call
 * site — not just `Record<string, NotificationTypeDefinition<any>>` — so TypeScript resolves
 * `context`'s required shape per call from `C[K]`'s own `buildContent` parameter, the same way it
 * would if each notification type still lived in its own separately-typed catalog file. Passing
 * `NOTIFICATION_CATALOG` and the literal key `'vehicle.compliance_expired'` requires `context` to
 * be exactly `VehicleComplianceContext`; passing a mismatched context for that key is a compile
 * error, same as passing `'some.unknown.key'` not present in the catalog at all.
 */
export interface NotifyByType {
  <C extends Record<string, NotificationTypeDefinition<unknown>>, K extends keyof C>(
    catalog: C,
    type: K,
    tenantId: string,
    context: C[K] extends NotificationTypeDefinition<infer TContext> ? TContext : never,
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
 * vehicle-compliance-alerts.worker.ts's BullMQ job handler, which relies on the throw propagating
 * so a transient failure (e.g. Redis/DB hiccup) retries per the queue's defaultJobOptions instead
 * of silently dropping the alert. A future caller invoked directly from a request path (not via a
 * queue) must wrap its own call in try/catch if it wants best-effort, fire-and-forget semantics —
 * see vehicle.service.ts's scheduleComplianceAlerts for that pattern.
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
): Promise<void> {
  const definition = catalog[type];
  try {
    const recipients = await deps.authRepository.listUsersByRole(
      tenantId,
      definition.recipientRoles,
    );
    const { title, body, metadata } = definition.buildContent(context);

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
        const channels: NotificationChannelName[] = [];
        const destinations: NotificationDestinations = {};

        if (definition.channels.includes('email') && recipient.email && enabled.email) {
          channels.push('email');
          destinations.email = recipient.email;
        }
        if (definition.channels.includes('whatsapp') && recipient.phoneNumber && enabled.whatsapp) {
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
        });
      }),
    );
  } catch (error) {
    rethrow(error, `Failed to notify by type ${type} for tenant ${tenantId}`);
  }
}

/**
 * The typed factory every composition-root caller uses — the cast here is the one place this
 * module trusts `notifyByTypeImpl`'s internals; every actual call site (e.g.
 * vehicle-compliance-alerts.worker.ts) goes through the precise `NotifyByType` signature above
 * and gets full compile-time checking of `type`/`context` against whatever catalog it passes.
 */
export function createNotifyByType(deps: NotifyByTypeDeps): NotifyByType {
  const notifyByType = (
    catalog: Record<string, NotificationTypeDefinition<unknown>>,
    type: string,
    tenantId: string,
    context: unknown,
  ): Promise<void> => notifyByTypeImpl(deps, catalog, type, tenantId, context);
  return notifyByType as NotifyByType;
}
