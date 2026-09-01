import { DataSource } from 'typeorm';
import { VehicleService } from '../masters/vehicle.service';
import { DriverService } from '../masters/driver.service';
import { CustomerService } from '../customers/customer.service';
import { DashboardsRepository } from './dashboards.repository';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';
import { createDashboardsRoutes } from './dashboards.routes';

export function createDashboardsModule(
  dataSource: DataSource,
  deps: {
    vehicleService: VehicleService;
    driverService: DriverService;
    customerService: CustomerService;
  },
) {
  const repository = new DashboardsRepository(dataSource);
  const service = new DashboardsService(
    repository,
    deps.vehicleService,
    deps.driverService,
    deps.customerService,
  );
  const controller = new DashboardsController(service);
  const router = createDashboardsRoutes(controller);

  return { service, router };
}
