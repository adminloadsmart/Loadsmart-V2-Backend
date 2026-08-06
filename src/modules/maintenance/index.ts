import { DataSource } from 'typeorm';
import { MaintenanceRepository } from './maintenance.repository';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';
import { createMaintenanceRoutes } from './maintenance.routes';
import { NotificationsGateway } from './gateways/notifications.gateway';

export interface MaintenanceModuleDeps {
    notificationsGateway: NotificationsGateway;
}

export function createMaintenanceModule(dataSource: DataSource, { notificationsGateway }: MaintenanceModuleDeps) {
    const repository = new MaintenanceRepository(dataSource);
    const service = new MaintenanceService(repository, notificationsGateway);
    const controller = new MaintenanceController(service);
    const router = createMaintenanceRoutes(controller);
    return { service, router };
}
