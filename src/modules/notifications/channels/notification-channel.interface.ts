import { NotificationEntity } from '../notifications.entity';

/**
 * One implementation per external channel (email/sms/push — see channels/*.channel.ts). The
 * BullMQ worker (workers/notification-dispatch.worker.ts) calls `send` for the channel named by
 * the job it picked up, passing the exact destination string the caller supplied to
 * NotificationsService.send() for that channel.
 *
 * Must throw on any failure — the worker relies on that to record a 'failed' delivery and let
 * BullMQ retry per the queue's defaultJobOptions (see jobs/queue-registry.ts). Must resolve only
 * once the send is actually confirmed, not just attempted.
 */
export interface NotificationChannel {
  send(notification: NotificationEntity, destination: string): Promise<void>;
}
