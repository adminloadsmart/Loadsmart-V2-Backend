import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { NotificationDestinations } from './notifications.interface';
import { NotificationChannelName } from './notifications.types';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import { rethrow } from '../../shared/errors';

export interface NotifyByTypeDeps {
  notificationsService: NotificationsService;
  authRepository: AuthRepository; // role-based recipient lookup
  authService: AuthService; // getActiveDeviceTokensForUser, for the 'push' channel
}

/** Generic call signature so callers stay typed against each catalog's own per-type context. */
export interface NotifyByType {
  <TContext>(
    catalog: Record<string, NotificationTypeDefinition<TContext>>,
    type: string,
    tenantId: string,
    context: TContext,
  ): Promise<void>;
}

/**
 * The one dispatcher every trigger site calls against a domain catalog (masters-notifications.
 * catalog.ts, vehicle-notifications.catalog.ts, and later load-notifications.catalog.ts) — resolves
 * recipients by role, builds content, and picks a channel+destination per recipient based on what
 * contact info they actually have. Best-effort: a dispatch failure is logged, never thrown, so a
 * notification never fails the business action that triggered it.
 */
export function createNotifyByType(deps: NotifyByTypeDeps): NotifyByType {
  return async function notifyByType<TContext>(
    catalog: Record<string, NotificationTypeDefinition<TContext>>,
    type: string,
    tenantId: string,
    context: TContext,
  ): Promise<void> {
    const definition = catalog[type];
    try {
      const recipients = await deps.authRepository.listUsersByRole(
        tenantId,
        definition.recipientRoles,
      );
      const { title, body, metadata } = definition.buildContent(context);

      await Promise.all(
        recipients.map(async (recipient) => {
          const channels: NotificationChannelName[] = [];
          const destinations: NotificationDestinations = {};

          if (definition.channels.includes('email') && recipient.email) {
            channels.push('email');
            destinations.email = recipient.email;
          }
          if (definition.channels.includes('whatsapp') && recipient.phoneNumber) {
            channels.push('whatsapp');
            destinations.whatsappNumber = recipient.phoneNumber;
          }
          if (definition.channels.includes('push')) {
            // Picks a single active device token per recipient rather than fanning out to every
            // device (dispatch-planning.service.ts's notifyAssignedDrivers fans out per driver
            // session instead) — a deliberate simplification for this first batch of producers.
            const [session] = await deps.authService.getActiveDeviceTokensForUser(recipient.id);
            if (session?.fcmToken) {
              channels.push('push');
              destinations.pushToken = session.fcmToken;
            }
          }

          // No early-return when channels is empty — a recipient reachable on none of the
          // declared external channels (or a type with no declared channels at all, e.g.
          // 'master.approval_requested' while email is unset up) still gets the notification row
          // itself, visible via GET /notifications; see notifications.types.ts's own note that
          // channels: [] means in-app only, not "nothing to do".
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
  };
}
