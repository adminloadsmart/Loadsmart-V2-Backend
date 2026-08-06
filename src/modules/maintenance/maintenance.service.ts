import { MaintenanceRepository } from './maintenance.repository';
import { NotificationsGateway } from './gateways/notifications.gateway';

export class MaintenanceService {
    constructor(
        private readonly maintenanceRepository: MaintenanceRepository,
        private readonly notificationsGateway: NotificationsGateway,
    ) { }

    // TODO: business logic
}
