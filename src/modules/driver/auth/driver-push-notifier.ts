import { Msg91Client } from '../../../adapters/msg91.client';
import { whatsappRequestIdOf } from '../../../adapters/msg91-whatsapp-report';
import { env } from '../../../config/env';
import { NotificationEntity } from '../../notifications/notifications.entity';
import { PushChannel } from '../../notifications/channels/push.channel';
import { NotificationsService } from '../../notifications/notifications.service';
import { DriverSessionRepository } from './driver-auth.repository';
import { DriverInviteNotifyResult, DriverInviteWhatsAppResult } from './driver-auth.types';
import { DRIVER_INVITED_NOTIFICATION_TYPE } from '../driver.constants';

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
    private readonly msg91Client: Msg91Client = new Msg91Client(),
  ) {}

  /**
   * The invite's WhatsApp, from the business number via MSG91 — sent once, straight from the
   * request (not the notifications queue), so a Resend is the retry. `skipped` = the template or
   * app link isn't configured; the invite still goes out on push. Best-effort like push(): a
   * failure is returned, never thrown. `trackedLink` (when API_PUBLIC_URL is set) replaces the
   * plain app link so the tap is recorded; `requestId` lets MSG91's delivery reports find the invite.
   */
  async notifyInvitedOnWhatsApp(
    phoneNumber: string,
    tenantName: string,
    trackedLink: string | null,
  ): Promise<DriverInviteWhatsAppResult> {
    const templateName = env.msg91WhatsappTemplateDriverInvite;
    if (!templateName || !env.driverAppUrl) {
      console.info(
        `Driver invite WhatsApp to ${phoneNumber} skipped — MSG91_WHATSAPP_TEMPLATE_DRIVER_INVITE / DRIVER_APP_URL not configured`,
      );
      return { status: 'skipped', requestId: null };
    }
    try {
      const response = await this.msg91Client.sendWhatsapp(
        phoneNumber,
        [tenantName, trackedLink ?? env.driverAppUrl],
        templateName,
      );
      const requestId = whatsappRequestIdOf(response);
      // Accepted is not delivered — Meta's rejection reason only shows in MSG91's WhatsApp reports.
      console.info(
        `Driver invite WhatsApp to ${phoneNumber} accepted by MSG91 — template=${templateName}, requestId=${requestId ?? 'none found'}, response=${JSON.stringify(response ?? null)}`,
      );
      return { status: 'sent', requestId };
    } catch (error) {
      console.warn(
        `Driver invite WhatsApp to ${phoneNumber} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { status: 'failed', requestId: null };
    }
  }

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
   * Persists first so the push can carry the in-app notification's id, which the app uses to open
   * and mark it read. Returns whether the push reached at least one device — recorded as the
   * invite's push delivery status — and the in-app notification's id (null if it couldn't be saved).
   */
  async notifyInvited(
    tenantId: string,
    driverId: string,
    tenantName: string,
    invitationId: string,
  ): Promise<DriverInviteNotifyResult> {
    const type = DRIVER_INVITED_NOTIFICATION_TYPE;
    const title = "You've been invited";
    const body = `${tenantName} has invited you to join their fleet. Open the app to accept or decline.`;
    const notification = await this.persist(tenantId, driverId, type, title, body, {
      invitationId,
    });
    const pushed = await this.push(driverId, title, body, {
      type,
      invitationId,
      ...(notification && { notificationId: notification.id }),
    });
    return { pushed, notificationId: notification?.id ?? null };
  }

  /** A trip reminder to the driver's app (e.g. upload the E-POD) — push plus an in-app row. */
  notifyTripReminder(
    tenantId: string,
    driverId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    return this.send(tenantId, driverId, type, title, body);
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
