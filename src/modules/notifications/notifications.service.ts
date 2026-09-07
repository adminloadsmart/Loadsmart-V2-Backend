import { NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { paginate } from '../../shared/utils/pagination';
import { JobQueue } from '../../jobs/queue-registry';
import { NotificationRepository } from './notification.repository';
import { NotificationEntity } from './notifications.entity';
import {
  CreateNotificationInput,
  ListNotificationsInput,
  NotificationDestinations,
} from './notifications.interface';
import { NotificationChannelName, DeliveryStatus } from './notifications.types';

function resolveDestination(
  channel: NotificationChannelName,
  destinations: NotificationDestinations | undefined,
): string | undefined {
  switch (channel) {
    case 'email':
      return destinations?.email;
    case 'sms':
      return destinations?.phoneNumber;
    case 'push':
      return destinations?.pushToken;
  }
}

export class NotificationsService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly jobQueue: JobQueue,
  ) {}

  /**
   * The module's one producer-facing entry point — called in-process by other services (nothing
   * calls it yet in this change; see the module's plan notes). There is no HTTP route for this,
   * so no zod middleware runs in front of it — the destination check below is the only
   * validation layer, don't assume it's covered elsewhere.
   */
  async send(tenantId: string, input: CreateNotificationInput): Promise<NotificationEntity> {
    try {
      const channels = input.channels ?? [];
      const destinations: Partial<Record<NotificationChannelName, string>> = {};

      for (const channel of channels) {
        const destination = resolveDestination(channel, input.destinations);
        if (!destination) {
          throw new ValidationError(
            `Channel "${channel}" was requested but no matching destination was provided`,
          );
        }
        destinations[channel] = destination;
      }

      const notification = await this.repository.createWithDeliveries(
        {
          tenantId,
          recipientUserId: input.recipientUserId,
          type: input.type,
          title: input.title,
          body: input.body,
          channels,
          metadata: input.metadata ?? null,
        },
        destinations,
      );

      for (const channel of channels) {
        await this.jobQueue.enqueue(channel, { notificationId: notification.id });
      }

      return notification;
    } catch (error) {
      rethrow(error, 'Failed to send notification');
    }
  }

  async list(tenantId: string, recipientUserId: string, input: ListNotificationsInput) {
    try {
      const [items, total] = await this.repository.listByRecipient(
        tenantId,
        recipientUserId,
        input,
      );
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list notifications');
    }
  }

  /** Full detail of one of the caller's own notifications, including per-channel delivery
   *  outcomes. 404s (rather than 403) when the notification doesn't exist or isn't theirs. */
  async get(tenantId: string, recipientUserId: string, id: string) {
    try {
      const notification = await this.repository.findByIdForRecipient(
        tenantId,
        recipientUserId,
        id,
      );
      if (!notification) throw new NotFoundError(`Notification ${id} not found`);
      const deliveries = await this.repository.findDeliveriesByNotificationId(notification.id);
      return { ...notification, deliveries };
    } catch (error) {
      rethrow(error, 'Failed to fetch notification');
    }
  }

  async markRead(tenantId: string, recipientUserId: string, id: string) {
    try {
      const notification = await this.repository.markRead(tenantId, recipientUserId, id);
      if (!notification) throw new NotFoundError(`Notification ${id} not found`);
      return notification;
    } catch (error) {
      rethrow(error, 'Failed to mark notification read');
    }
  }

  // --- Worker-facing (workers/notification-dispatch.worker.ts) — not exposed over HTTP. ---

  /** Loads the notification plus the given channel's destination in one call. */
  async prepareDispatch(
    notificationId: string,
    channel: NotificationChannelName,
  ): Promise<{ notification: NotificationEntity; destination: string }> {
    const notification = await this.repository.findById(notificationId);
    if (!notification) throw new NotFoundError(`Notification ${notificationId} not found`);

    const delivery = await this.repository.findDelivery(notificationId, channel);
    if (!delivery) {
      throw new NotFoundError(
        `Delivery row for notification ${notificationId} channel "${channel}" not found`,
      );
    }

    return { notification, destination: delivery.destination };
  }

  recordDeliveryResult(
    notificationId: string,
    channel: NotificationChannelName,
    result: { status: DeliveryStatus; error?: string | null },
  ) {
    return this.repository.recordDeliveryResult(notificationId, channel, result);
  }
}
