import { Job, UnrecoverableError, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { NOTIFICATION_CATALOG } from '../catalog/notification-catalog';
import { NotifyByType } from '../notify-by-type';
import { NOTIFICATION_TRIGGERS_QUEUE, NotificationTriggerPayload } from '../notification-triggers';

/**
 * BullMQ Worker for the 'notification-triggers' queue (see notification-triggers.ts), started
 * in-process like the dispatch worker. Runs notifyByType for the queued `{ type, tenantId,
 * context }`; a throw (notifyByType rethrows on any failure) makes BullMQ retry the job per the
 * queue's defaultJobOptions. Built in composition-root.ts, since notifyByType needs auth's
 * repository/service.
 */
export function createNotificationTriggerWorker(notifyByType: NotifyByType): Worker {
  return new Worker<NotificationTriggerPayload>(
    NOTIFICATION_TRIGGERS_QUEUE,
    async (job: Job<NotificationTriggerPayload>) => {
      const { type, tenantId, context } = job.data;
      // A type removed from the catalog after its job was queued can never succeed — fail it
      // once (kept in the failed set for inspection) instead of burning retries.
      if (!(type in NOTIFICATION_CATALOG)) {
        throw new UnrecoverableError(`Unknown notification type "${type}"`);
      }
      await notifyByType(NOTIFICATION_CATALOG, type, tenantId, context as never);
    },
    { connection: getQueueConnection(), concurrency: 5 },
  );
}
