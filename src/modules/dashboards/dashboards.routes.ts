import { Router } from 'express';
import { DashboardsController } from './dashboards.controller';

export function createDashboardsRoutes(_controller: DashboardsController): Router {
    const router = Router();
    // TODO: register routes
    return router;
}
