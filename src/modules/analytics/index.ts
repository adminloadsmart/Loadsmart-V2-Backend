import { DataSource } from 'typeorm';
import { AnalyticsController } from './analytics.controller';
import { registerAnalyticsOpenApi } from './analytics.openapi';
import { AnalyticsRepository } from './analytics.repository';
import { createAnalyticsRoutes } from './analytics.routes';
import { AnalyticsService } from './analytics.service';

export function createAnalyticsModule(dataSource: DataSource) {
  const repository = new AnalyticsRepository(dataSource);
  const service = new AnalyticsService(repository);
  const controller = new AnalyticsController(service);
  const router = createAnalyticsRoutes(controller);

  return { service, router, registerOpenApi: registerAnalyticsOpenApi };
}
