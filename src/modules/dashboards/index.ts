import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';
import { createDashboardsRoutes } from './dashboards.routes';

export function createDashboardsModule() {
  const service = new DashboardsService();
  const controller = new DashboardsController(service);
  const router = createDashboardsRoutes(controller);
  return { service, router };
}
