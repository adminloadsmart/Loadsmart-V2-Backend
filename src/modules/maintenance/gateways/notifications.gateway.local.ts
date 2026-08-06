import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from './notifications.gateway';

export class NotificationsGatewayLocal implements NotificationsGateway {
    constructor(private readonly notificationsService: NotificationsService) { }
}
