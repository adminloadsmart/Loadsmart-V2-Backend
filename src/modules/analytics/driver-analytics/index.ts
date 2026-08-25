import { DataSource } from 'typeorm';
import { DriverAnalyticsController } from './driver-analytics.controller';
import { registerDriverAnalyticsOpenApi } from './driver-analytics.openapi';
import { DriverAnalyticsRepository } from './driver-analytics.repository';
import { createDriverAnalyticsRoutes } from './driver-analytics.routes';
import { DriverAnalyticsService } from './driver-analytics.service';

export function createDriverAnalyticsModule(dataSource: DataSource) {
  const repository = new DriverAnalyticsRepository(dataSource);
  const service = new DriverAnalyticsService(repository);
  const controller = new DriverAnalyticsController(service);
  const router = createDriverAnalyticsRoutes(controller);

  return { service, router, registerOpenApi: registerDriverAnalyticsOpenApi };
}
