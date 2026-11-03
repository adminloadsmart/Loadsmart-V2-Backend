import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { NotificationsService } from '../notifications.service';
import { NotificationChannel } from '../channels/notification-channel.interface';
import { NotificationChannelName } from '../notifications.types';

interface DispatchJobPayload {
  notificationId: string;
}

/**
 * BullMQ Worker for the 'notifications' queue, started in-process alongside the API server (see
 * modules/notifications/index.ts + server.ts) — this repo has no separate worker process. One
 * job per (notification, channel); `job.name` is the channel to dispatch on.
 */
export function createNotificationDispatchWorker(
  notificationsService: NotificationsService,
  channels: Record<NotificationChannelName, NotificationChannel>,
): Worker {
  return new Worker<DispatchJobPayload>(
    'notifications',
    async (job: Job<DispatchJobPayload>) => {
      const channelName = job.name as NotificationChannelName;
      const channel = channels[channelName];
      if (!channel) {
        throw new Error(`No NotificationChannel registered for job name "${job.name}"`);
      }

      const { notification, destination } = await notificationsService.prepareDispatch(
        job.data.notificationId,
        channelName,
      );

      try {
        await channel.send(notification, destination);
        await notificationsService.recordDeliveryResult(notification.id, channelName, {
          status: 'sent',
        });
      } catch (error) {
        await notificationsService.recordDeliveryResult(notification.id, channelName, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        // Rethrow so BullMQ counts this attempt and retries per the queue's defaultJobOptions
        // (see jobs/queue-registry.ts) — swallowing here would make the job "succeed" despite
        // the channel failing.
        throw error;
      }
    },
    { connection: getQueueConnection(), concurrency: 5 },
  );
}
