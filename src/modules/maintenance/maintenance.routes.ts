import { Router } from 'express';
import { MaintenanceController } from './maintenance.controller';

export function createMaintenanceRoutes(_controller: MaintenanceController): Router {
  const router = Router();
  // TODO: register routes
  return router;
}
