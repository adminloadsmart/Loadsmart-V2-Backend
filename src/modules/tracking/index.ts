import { DataSource } from 'typeorm';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { createTrackingRoutes } from './tracking.routes';

export function createTrackingModule(dataSource: DataSource) {
  const repository = new TrackingRepository(dataSource);
  const service = new TrackingService(repository);
  const controller = new TrackingController(service);
  const router = createTrackingRoutes(controller);
  return { service, router };
}
