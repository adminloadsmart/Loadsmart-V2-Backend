import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationTriggers } from '../../notifications/notification-triggers';
import { NotificationsGateway } from './notifications.gateway';

export class NotificationsGatewayLocal implements NotificationsGateway {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly triggers?: NotificationTriggers,
  ) {}

  async vehicleBackInService({ tenantId, jobId }: { tenantId: string; jobId: string }) {
    try {
      await this.triggers?.enqueue('vehicle.back_in_service', tenantId, { jobId });
    } catch (error) {
      console.warn(`Failed to queue back-in-service notification for job ${jobId}`, error);
    }
  }
}
