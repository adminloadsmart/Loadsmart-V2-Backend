import { DataSource } from 'typeorm';
import { createShipperAnalyticsModule } from './shipper';

export function createAnalyticsModule(dataSource: DataSource) {
  return createShipperAnalyticsModule(dataSource);
}
