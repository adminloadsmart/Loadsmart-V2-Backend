import { Msg91Client } from '../../../adapters/msg91.client';
import { whatsappRequestIdOf } from '../../../adapters/msg91-whatsapp-report';
import { env } from '../../../config/env';
import { DEFAULT_LOCALE } from '../../../shared/i18n/locales';
import { renderDriverMessage } from '../../notifications/driver-notification-content';
import { DRIVER_MESSAGE_PARAMS_KEY } from '../../notifications/notifications.constants';
import { NotificationEntity } from '../../notifications/notifications.entity';
import { DriverMessage } from '../../notifications/notifications.types';
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
      // Recorded as a failed WhatsApp on the invite (DriverService.deliverInvite).
      console.warn(
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
   * no FCM-registered session or every send failed. Each device gets the text in its own session
   * language. `data` rides along as the FCM data payload.
   */
  private async push(
    driverId: string,
    message: DriverMessage,
    data?: Record<string, string>,
  ): Promise<boolean> {
    try {
      const sessions = await this.driverSessionRepository.findActiveByDriverId(driverId);
      const results = await Promise.allSettled(
        sessions
          .filter((session) => session.fcmToken)
          .map((session) => {
            const { title, body } = renderDriverMessage(message, session.locale ?? DEFAULT_LOCALE);
            const notification = { title, body, metadata: data } as unknown as NotificationEntity;
            return this.pushChannel.send(notification, session.fcmToken!);
          }),
      );
      return results.some((result) => result.status === 'fulfilled');
    } catch {
      // Best-effort — a failed push must never fail the invite/approval action itself.
      return false;
    }
  }

  /** Saved with English text plus the message's params, so the in-app list re-renders it in
   *  the app's language (DriverPortalService.getMyNotifications). */
  private async persist(
    tenantId: string,
    driverId: string,
    message: DriverMessage,
    metadata?: Record<string, unknown>,
  ): Promise<NotificationEntity | null> {
    try {
      const { title, body } = renderDriverMessage(message, DEFAULT_LOCALE);
      return await this.notificationsService.send(tenantId, {
        recipientUserId: driverId,
        type: message.type,
        title,
        body,
        channels: [],
        metadata: { ...metadata, [DRIVER_MESSAGE_PARAMS_KEY]: message.params },
      });
    } catch {
      // Best-effort, same reasoning as push() above.
      return null;
    }
  }

  private async send(tenantId: string, driverId: string, message: DriverMessage): Promise<void> {
    await Promise.all([this.push(driverId, message), this.persist(tenantId, driverId, message)]);
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
    const message: DriverMessage = {
      type: DRIVER_INVITED_NOTIFICATION_TYPE,
      params: { tenantName },
    };
    const notification = await this.persist(tenantId, driverId, message, { invitationId });
    const pushed = await this.push(driverId, message, {
      type: message.type,
      invitationId,
      ...(notification && { notificationId: notification.id }),
    });
    return { pushed, notificationId: notification?.id ?? null };
  }

  /** A trip reminder to the driver's app (e.g. upload the E-POD) — push plus an in-app row. */
  notifyTripReminder(tenantId: string, driverId: string, message: DriverMessage): Promise<void> {
    return this.send(tenantId, driverId, message);
  }

  notifyJoinRequestApproved(tenantId: string, driverId: string, tenantName: string): Promise<void> {
    return this.send(tenantId, driverId, {
      type: 'driver.account.join_approved',
      params: { tenantName },
    });
  }

  notifyJoinRequestRejected(tenantId: string, driverId: string, tenantName: string): Promise<void> {
    return this.send(tenantId, driverId, {
      type: 'driver.account.join_rejected',
      params: { tenantName },
    });
  }
}
