import { NotificationEntity } from '../notifications/notifications.entity';
import { PushChannel } from '../notifications/channels/push.channel';
import { DriverSessionRepository } from './driver-auth.repository';

/**
 * Minimal, ad hoc push delivery for driver-side link events ("you've been invited", "your join
 * request was approved") — deliberately NOT routed through notifyByType/NOTIFICATION_CATALOG,
 * since that dispatcher resolves recipients via AuthRepository.listUsersByRole (auth.users rows),
 * and a driver has none — see driver-auth.service.ts's own doc comment on why. This bypasses the
 * notification catalog/preferences/persisted-notification-row machinery entirely: best-effort,
 * fire-and-forget, no in-app history. Fleet-owner-side events for the same workflow (a driver
 * requested to join, a driver accepted an invite) DO go through the catalog — see
 * notification-catalog.ts's `driver.link_requested`/`driver.link_accepted`.
 */
export class DriverPushNotifier {
  constructor(
    private readonly driverSessionRepository: DriverSessionRepository,
    private readonly pushChannel: PushChannel = new PushChannel(),
  ) {}

  private async send(driverId: string, title: string, body: string): Promise<void> {
    try {
      const sessions = await this.driverSessionRepository.findActiveByDriverId(driverId);
      const notification = { title, body, metadata: undefined } as unknown as NotificationEntity;
      await Promise.all(
        sessions
          .filter((session) => session.fcmToken)
          .map((session) => this.pushChannel.send(notification, session.fcmToken!)),
      );
    } catch {
      // Best-effort — a failed push must never fail the invite/approval action itself.
    }
  }

  notifyInvited(driverId: string, tenantName: string): Promise<void> {
    return this.send(
      driverId,
      "You've been invited",
      `${tenantName} has invited you to join their fleet. Open the app to accept or decline.`,
    );
  }

  notifyJoinRequestApproved(driverId: string, tenantName: string): Promise<void> {
    return this.send(
      driverId,
      'Request approved',
      `Your request to join ${tenantName} has been approved.`,
    );
  }

  notifyJoinRequestRejected(driverId: string, tenantName: string): Promise<void> {
    return this.send(
      driverId,
      'Request declined',
      `Your request to join ${tenantName} was declined.`,
    );
  }
}
