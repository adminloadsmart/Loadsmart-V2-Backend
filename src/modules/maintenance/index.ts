import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { MaintenanceJobRepository } from './repositories/maintenance-job.repository';
import { MaintenanceFleetRepository } from './repositories/fleet.repository';
import { TyreRepository } from './repositories/tyre.repository';
import { BatteryRepository } from './repositories/battery.repository';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceOverviewService } from './maintenance-overview.service';
import { TyreService } from './tyre.service';
import { BatteryService } from './battery.service';
import { MaintenanceController } from './maintenance.controller';
import { createMaintenanceRoutes } from './maintenance.routes';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { FleetGateway } from './gateways/fleet.gateway';

export interface MaintenanceModuleDeps {
  notificationsGateway: NotificationsGateway;
  fleetGateway: FleetGateway;
  auditService: AuditService;
}

export function createMaintenanceModule(
  dataSource: DataSource,
  { notificationsGateway, fleetGateway, auditService }: MaintenanceModuleDeps,
) {
  const jobRepository = new MaintenanceJobRepository(dataSource);
  const fleetRepository = new MaintenanceFleetRepository(dataSource);
  const tyreRepository = new TyreRepository(dataSource);
  const batteryRepository = new BatteryRepository(dataSource);

  const service = new MaintenanceService(
    dataSource,
    jobRepository,
    fleetRepository,
    fleetGateway,
    auditService,
    notificationsGateway,
  );
  const tyreService = new TyreService(tyreRepository, service, auditService);
  const batteryService = new BatteryService(batteryRepository, service, auditService);
  const overviewService = new MaintenanceOverviewService(jobRepository, service, tyreService);

  const controller = new MaintenanceController(
    service,
    overviewService,
    tyreService,
    batteryService,
  );
  const router = createMaintenanceRoutes(controller);
  return { service, router };
}
