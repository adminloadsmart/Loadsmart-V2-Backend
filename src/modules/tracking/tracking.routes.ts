import { Router } from 'express';
import { TrackingController } from './tracking.controller';

export function createTrackingRoutes(_controller: TrackingController): Router {
  const router = Router();
  // TODO: register routes
  return router;
}
