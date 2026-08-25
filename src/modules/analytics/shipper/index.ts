import { DataSource } from 'typeorm';
import { ShipperAnalyticsController } from './shipper-analytics.controller';
import { registerShipperAnalyticsOpenApi } from './shipper-analytics.openapi';
import { ShipperAnalyticsRepository } from './shipper-analytics.repository';
import { createShipperAnalyticsRoutes } from './shipper-analytics.routes';
import { ShipperAnalyticsService } from './shipper-analytics.service';

export function createShipperAnalyticsModule(dataSource: DataSource) {
  const repository = new ShipperAnalyticsRepository(dataSource);
  const service = new ShipperAnalyticsService(repository);
  const controller = new ShipperAnalyticsController(service);
  const router = createShipperAnalyticsRoutes(controller);

  return { service, router, registerOpenApi: registerShipperAnalyticsOpenApi };
}
