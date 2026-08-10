import { VehicleService } from '../masters/vehicle.service';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';
import { createDashboardsRoutes } from './dashboards.routes';

export function createDashboardsModule(deps: { vehicleService: VehicleService }) {
  const service = new DashboardsService(deps.vehicleService);
  const controller = new DashboardsController(service);
  const router = createDashboardsRoutes(controller);

  return { service, router };
}
