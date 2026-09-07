import { DataSource } from 'typeorm';
import { Worker } from 'bullmq';
import { createJobQueue } from '../../jobs/queue-registry';
import { Msg91Client } from '../../adapters/msg91.client';
import { NotificationRepository } from './notification.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { createNotificationsRoutes } from './notifications.routes';
import { createNotificationDispatchWorker } from './workers/notification-dispatch.worker';
import { NotificationChannel } from './channels/notification-channel.interface';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { NotificationChannelName } from './notifications.types';

export interface NotificationsModule {
  service: NotificationsService;
  router: ReturnType<typeof createNotificationsRoutes>;
  worker: Worker;
}

/** No cross-module deps — a "producer" module, same build-order bucket as tracking/payments in
 *  composition-root.ts. Starts its BullMQ Worker in-process here; server.ts closes it (via
 *  Container.backgroundWorkers) on graceful shutdown. */
export function createNotificationsModule(dataSource: DataSource): NotificationsModule {
  const repository = new NotificationRepository(dataSource);
  const jobQueue = createJobQueue('notifications');
  const service = new NotificationsService(repository, jobQueue);
  const controller = new NotificationsController(service);
  const router = createNotificationsRoutes(controller);

  const msg91Client = new Msg91Client(); // per-module adapter instance, same pattern
  // masters/index.ts uses for SarathiClient.
  const channels: Record<NotificationChannelName, NotificationChannel> = {
    email: new EmailChannel(),
    sms: new SmsChannel(msg91Client),
    push: new PushChannel(),
  };
  const worker = createNotificationDispatchWorker(service, channels);

  return { service, router, worker };
}
