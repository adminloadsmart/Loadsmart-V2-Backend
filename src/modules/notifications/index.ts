import { DataSource } from 'typeorm';
import { NotificationRepository } from './notification.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { createNotificationsRoutes } from './notifications.routes';

export function createNotificationsModule(dataSource: DataSource) {
  const repository = new NotificationRepository(dataSource);
  const service = new NotificationsService(repository);
  const controller = new NotificationsController(service);
  const router = createNotificationsRoutes(controller);
  return { service, router };
}
