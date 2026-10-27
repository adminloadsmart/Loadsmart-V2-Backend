import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationTriggers } from '../../notifications/notifications.interface';
import { VehicleBackInServiceEvent } from '../maintenance.interface';

export class NotificationsGatewayLocal implements NotificationsGateway {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly triggers?: NotificationTriggers,
  ) {}

  async vehicleBackInService({ tenantId, jobId }: VehicleBackInServiceEvent) {
    try {
      await this.triggers?.enqueue('vehicle.back_in_service', tenantId, { jobId });
    } catch (error) {
      console.warn(`Failed to queue back-in-service notification for job ${jobId}`, error);
    }
  }
}
