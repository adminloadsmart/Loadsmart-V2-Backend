import { DataSource } from 'typeorm';
import { Router } from 'express';
import { Worker } from 'bullmq';
import { createJobQueue } from '../../jobs/queue-registry';
import { Msg91Client } from '../../adapters/msg91.client';
import { NotificationRepository } from './notification.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { createNotificationsRoutes } from './notifications.routes';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { createNotificationPreferencesRoutes } from './notification-preferences.routes';
import { createNotificationDispatchWorker } from './workers/notification-dispatch.worker';
import { NotificationChannel } from './channels/notification-channel.interface';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { NotificationChannelName } from './notifications.types';

export interface NotificationsModule {
  service: NotificationsService;
  router: Router;
  worker: Worker;
  // Exposed so composition-root can wire it into notify-by-type.ts's preferences gating —
  // notify-by-type.ts lives here too, but it's built in composition-root.ts alongside auth's
  // services, so this repository crosses the same boundary.
  notificationPreferencesRepository: NotificationPreferencesRepository;
}

/** No cross-module deps — a "producer" module, same build-order bucket as tracking/payments in
 *  composition-root.ts. Starts its BullMQ Worker in-process here; server.ts closes it (via
 *  Container.backgroundWorkers) on graceful shutdown. */
export function createNotificationsModule(dataSource: DataSource): NotificationsModule {
  const repository = new NotificationRepository(dataSource);
  const jobQueue = createJobQueue('notifications');
  const service = new NotificationsService(repository, jobQueue);
  const controller = new NotificationsController(service);
  const notificationsRouter = createNotificationsRoutes(controller);

  const notificationPreferencesRepository = new NotificationPreferencesRepository(dataSource);
  const notificationPreferencesService = new NotificationPreferencesService(
    notificationPreferencesRepository,
  );
  const notificationPreferencesController = new NotificationPreferencesController(
    notificationPreferencesService,
  );
  const preferencesRouter = createNotificationPreferencesRoutes(notificationPreferencesController);

  // /preferences MUST be mounted before notificationsRouter: notificationsRouter's own
  // GET/:notificationId is a single-segment wildcard that would otherwise swallow a request to
  // /notifications/preferences (matching "preferences" as if it were a notificationId) before it
  // ever reached preferencesRouter — Express tries routes in registration order.
  const router = Router();
  router.use('/preferences', preferencesRouter);
  router.use(notificationsRouter);

  const msg91Client = new Msg91Client(); // per-module adapter instance, same pattern
  // masters/index.ts uses for SarathiClient.
  const channels: Record<NotificationChannelName, NotificationChannel> = {
    email: new EmailChannel(),
    sms: new SmsChannel(msg91Client),
    push: new PushChannel(),
    whatsapp: new WhatsappChannel(msg91Client),
  };
  const worker = createNotificationDispatchWorker(service, channels);

  return { service, router, worker, notificationPreferencesRepository };
}
