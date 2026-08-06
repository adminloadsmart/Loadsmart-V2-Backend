import { Router } from 'express';
import { NotificationsController } from './notifications.controller';

export function createNotificationsRoutes(_controller: NotificationsController): Router {
    const router = Router();
    // TODO: register routes
    return router;
}
