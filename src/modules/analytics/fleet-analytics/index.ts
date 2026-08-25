import { DataSource } from 'typeorm';
import { FleetAnalyticsController } from './fleet-analytics.controller';
import { registerFleetAnalyticsOpenApi } from './fleet-analytics.openapi';
import { FleetAnalyticsRepository } from './fleet-analytics.repository';
import { createFleetAnalyticsRoutes } from './fleet-analytics.routes';
import { FleetAnalyticsService } from './fleet-analytics.service';

export function createFleetAnalyticsModule(dataSource: DataSource) {
  const repository = new FleetAnalyticsRepository(dataSource);
  const service = new FleetAnalyticsService(repository);
  const controller = new FleetAnalyticsController(service);
  const router = createFleetAnalyticsRoutes(controller);

  return { service, router, registerOpenApi: registerFleetAnalyticsOpenApi };
}
