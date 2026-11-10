import { Router } from 'express';
import { DataSource } from 'typeorm';
import { createSavedViewRoutes, SavedViewsService } from './saved-views/saved-views';
import { createShipperAnalyticsModule } from './shipper';

/** Mounted at /analytics: Shipper Analytics (/shipper/*) and the saved filter views. */
export function createAnalyticsModule(dataSource: DataSource) {
  const shipper = createShipperAnalyticsModule(dataSource);
  const router = Router();
  router.use(createSavedViewRoutes(new SavedViewsService(dataSource)));
  router.use(shipper.router);
  return { ...shipper, router };
}
