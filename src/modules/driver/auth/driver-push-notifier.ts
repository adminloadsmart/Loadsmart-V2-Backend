import { NotificationEntity } from '../../notifications/notifications.entity';
import { PushChannel } from '../../notifications/channels/push.channel';
import { NotificationsService } from '../../notifications/notifications.service';
import { DriverSessionRepository } from './driver-auth.repository';

/**
 * Ad hoc push delivery for driver-side link events ("you've been invited", "your join request
 * was approved") — deliberately NOT routed through notifyByType/NOTIFICATION_CATALOG, since that
 * dispatcher resolves recipients via AuthRepository.listUsersByRole (auth.users rows), and a
 * driver has none — see driver-auth.service.ts's own doc comment on why. Fleet-owner-side events
 * for the same workflow (a driver requested to join, a driver accepted an invite) DO go through
 * the catalog — see notification-catalog.ts's `driver.link_requested`/`driver.link_accepted`.
 *
 * Also persists an in-app row via NotificationsService.send() (type prefix `driver.account.*`,
 * channels: [] — no email/sms/whatsapp/push destination registry involved, that's what the push
 * side below already handles separately), so these three events show up in the driver's own
 * GET /driver-portal/me/notifications feed, not just as a fire-and-forget push. The push itself
 * stays best-effort/fire-and-forget (a failed push must never fail the invite/approval action);
 * the persisted row does too, for the same reason.
 */
export class DriverPushNotifier {
  constructor(
    private readonly driverSessionRepository: DriverSessionRepository,
    private readonly notificationsService: NotificationsService,
    private readonly pushChannel: PushChannel = new PushChannel(),
  ) {}

  /**
   * Returns whether at least one of the driver's devices accepted the push — false when they have
   * no FCM-registered session or every send failed. `data` rides along as the FCM data payload.
   */
  private async push(
    driverId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<boolean> {
    try {
      const sessions = await this.driverSessionRepository.findActiveByDriverId(driverId);
      const notification = { title, body, metadata: data } as unknown as NotificationEntity;
      const results = await Promise.allSettled(
        sessions
          .filter((session) => session.fcmToken)
          .map((session) => this.pushChannel.send(notification, session.fcmToken!)),
      );
      return results.some((result) => result.status === 'fulfilled');
    } catch {
      // Best-effort — a failed push must never fail the invite/approval action itself.
      return false;
    }
  }

  private async persist(
    tenantId: string,
    driverId: string,
    type: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<NotificationEntity | null> {
    try {
      return await this.notificationsService.send(tenantId, {
        recipientUserId: driverId,
        type,
        title,
        body,
        channels: [],
        metadata,
      });
    } catch {
      // Best-effort, same reasoning as push() above.
      return null;
    }
  }

  private async send(
    tenantId: string,
    driverId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    await Promise.all([
      this.push(driverId, title, body),
      this.persist(tenantId, driverId, type, title, body),
    ]);
  }

  /**
   * Persists first so the push can carry the in-app notification's id: when the driver opens it,
   * the app calls PATCH /driver-portal/me/notifications/:notificationId/read, which marks this
   * invitation viewed (DriverPortalService.markMyNotificationRead). Returns whether the push
   * reached at least one device — recorded as the invite's push delivery status.
   */
  async notifyInvited(
    tenantId: string,
    driverId: string,
    tenantName: string,
    invitationId: string,
  ): Promise<boolean> {
    const type = 'driver.account.invited';
    const title = "You've been invited";
    const body = `${tenantName} has invited you to join their fleet. Open the app to accept or decline.`;
    const notification = await this.persist(tenantId, driverId, type, title, body, {
      invitationId,
    });
    return this.push(driverId, title, body, {
      type,
      invitationId,
      ...(notification && { notificationId: notification.id }),
    });
  }

  notifyJoinRequestApproved(tenantId: string, driverId: string, tenantName: string): Promise<void> {
    return this.send(
      tenantId,
      driverId,
      'driver.account.join_approved',
      'Request approved',
      `Your request to join ${tenantName} has been approved.`,
    );
  }

  notifyJoinRequestRejected(tenantId: string, driverId: string, tenantName: string): Promise<void> {
    return this.send(
      tenantId,
      driverId,
      'driver.account.join_rejected',
      'Request declined',
      `Your request to join ${tenantName} was declined.`,
    );
  }
}
