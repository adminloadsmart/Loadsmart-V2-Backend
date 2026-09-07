import { DataSource, Repository } from 'typeorm';
import { NotificationEntity } from './notifications.entity';
import { NotificationDeliveryEntity } from './notification-delivery.entity';
import { NotificationChannelName, DeliveryStatus, NotificationStatus } from './notifications.types';
import { ListNotificationsInput } from './notifications.interface';

export interface CreateNotificationData {
  tenantId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  channels: NotificationChannelName[];
  metadata: Record<string, unknown> | null;
}

// Postgres error codes worth retrying the whole transaction for — both are about lock
// contention/ordering, not about the data itself, so simply trying again is correct.
const RETRYABLE_PG_ERROR_CODES = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
]);

function isRetryablePgError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    RETRYABLE_PG_ERROR_CODES.has((error as { code: unknown }).code as string)
  );
}

/**
 * Observed empirically (see the module's verification script): when multiple channels for the
 * SAME notification complete at nearly the same moment, their recordDeliveryResult transactions
 * can hit a genuine Postgres deadlock (40P01) around the pessimistic_write lock on the parent
 * notification row, even though the intent is for one to simply wait for the other. Retrying the
 * whole transaction is the standard, correct response — the lock contention is transient, not a
 * sign the data is wrong.
 */
async function withDeadlockRetry<T>(attempt: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let tryNumber = 1; ; tryNumber++) {
    try {
      return await attempt();
    } catch (error) {
      if (tryNumber >= maxAttempts || !isRetryablePgError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * tryNumber + Math.random() * 25));
    }
  }
}

/** Derives the parent notification's overall status from its deliveries. No 'retrying' state —
 *  a delivery that failed but will still be retried by BullMQ reads 'failed' here until (and
 *  unless) a later attempt succeeds; see notifications.types.ts. */
function computeOverallStatus(deliveries: NotificationDeliveryEntity[]): NotificationStatus {
  if (deliveries.length === 0) return 'sent';
  if (deliveries.every((delivery) => delivery.status === 'sent')) return 'sent';
  if (deliveries.every((delivery) => delivery.status === 'failed')) return 'failed';
  if (deliveries.some((delivery) => delivery.status === 'pending')) return 'processing';
  return 'partially_failed';
}

export class NotificationRepository {
  private readonly repo: Repository<NotificationEntity>;
  private readonly deliveryRepo: Repository<NotificationDeliveryEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(NotificationEntity);
    this.deliveryRepo = dataSource.getRepository(NotificationDeliveryEntity);
  }

  async create(data: Partial<NotificationEntity>): Promise<NotificationEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  findById(id: string): Promise<NotificationEntity | null> {
    return this.repo.findOneBy({ id });
  }

  /** Persists the notification plus one delivery row per requested channel, each carrying the
   *  destination the caller supplied for it — in-app-only (`channels: []`) notifications are
   *  'sent' immediately, since the worker never touches a notification with zero deliveries. */
  async createWithDeliveries(
    data: CreateNotificationData,
    destinations: Partial<Record<NotificationChannelName, string>>,
  ): Promise<NotificationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const notificationRepo = manager.getRepository(NotificationEntity);
      const deliveryRepo = manager.getRepository(NotificationDeliveryEntity);

      const notification = await notificationRepo.save(
        notificationRepo.create({
          tenantId: data.tenantId,
          recipientUserId: data.recipientUserId,
          type: data.type,
          title: data.title,
          body: data.body,
          channels: data.channels,
          metadata: data.metadata,
          status: data.channels.length ? 'pending' : 'sent',
          readAt: null,
        }),
      );

      if (data.channels.length) {
        const deliveryRows = data.channels.map((channel) => {
          const destination = destinations[channel];
          if (!destination) {
            throw new Error(`Missing destination for notification channel "${channel}"`);
          }
          return deliveryRepo.create({
            notificationId: notification.id,
            channel,
            destination,
            status: 'pending' as DeliveryStatus,
          });
        });
        await deliveryRepo.save(deliveryRows);
      }

      return notification;
    });
  }

  async listByRecipient(
    tenantId: string,
    recipientUserId: string,
    input: ListNotificationsInput,
  ): Promise<[NotificationEntity[], number]> {
    const qb = this.repo
      .createQueryBuilder('notification')
      .where('notification.tenant_id = :tenantId', { tenantId })
      .andWhere('notification.recipient_user_id = :recipientUserId', { recipientUserId });

    if (input.unreadOnly) {
      qb.andWhere('notification.read_at IS NULL');
    }

    return qb
      .orderBy('notification.created_at', 'DESC')
      .skip((input.page - 1) * input.limit)
      .take(input.limit)
      .getManyAndCount();
  }

  /** Scoped to (tenantId, recipientUserId) — returns null for a notification that doesn't exist
   *  OR belongs to someone else, so the controller 404s either way rather than leaking existence
   *  of another user's notification. */
  findByIdForRecipient(
    tenantId: string,
    recipientUserId: string,
    id: string,
  ): Promise<NotificationEntity | null> {
    return this.repo.findOneBy({ id, tenantId, recipientUserId });
  }

  findDeliveriesByNotificationId(notificationId: string): Promise<NotificationDeliveryEntity[]> {
    return this.deliveryRepo.find({ where: { notificationId } });
  }

  findDelivery(
    notificationId: string,
    channel: NotificationChannelName,
  ): Promise<NotificationDeliveryEntity | null> {
    return this.deliveryRepo.findOneBy({ notificationId, channel });
  }

  /** Idempotent — already-read is a no-op, not a conflict. Returns null if the notification
   *  doesn't exist or isn't the caller's. */
  async markRead(
    tenantId: string,
    recipientUserId: string,
    id: string,
  ): Promise<NotificationEntity | null> {
    const notification = await this.findByIdForRecipient(tenantId, recipientUserId, id);
    if (!notification) return null;
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return notification;
  }

  /**
   * Records one channel's dispatch outcome and recomputes the parent notification's overall
   * status. Runs inside a transaction with a pessimistic write lock on the parent row so two
   * channels' jobs finishing at nearly the same time serialize their recompute instead of one
   * clobbering the other's (same row-lock idiom as loads/code-sequence.repository.ts).
   */
  async recordDeliveryResult(
    notificationId: string,
    channel: NotificationChannelName,
    result: { status: DeliveryStatus; error?: string | null },
  ): Promise<NotificationEntity> {
    return withDeadlockRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const notificationRepo = manager.getRepository(NotificationEntity);
        const deliveryRepo = manager.getRepository(NotificationDeliveryEntity);

        await deliveryRepo.increment({ notificationId, channel }, 'attempts', 1);
        await deliveryRepo.update(
          { notificationId, channel },
          {
            status: result.status,
            error: result.error ?? null,
            ...(result.status === 'sent' ? { sentAt: new Date() } : {}),
          },
        );

        const notification = await notificationRepo.findOneOrFail({
          where: { id: notificationId },
          lock: { mode: 'pessimistic_write' },
        });

        const deliveries = await deliveryRepo.find({ where: { notificationId } });
        const newStatus = computeOverallStatus(deliveries);
        if (notification.status !== newStatus) {
          notification.status = newStatus;
          await notificationRepo.save(notification);
        }

        return notification;
      }),
    );
  }
}
