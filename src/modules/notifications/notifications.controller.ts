import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { ListNotificationsInput } from './notifications.interface';
import { NotificationsService } from './notifications.service';

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  listNotifications = async (req: Request, res: Response) =>
    respond(
      res,
      await this.notificationsService.list(
        requireTenantId(req),
        req.user!.id,
        req.validatedQuery as ListNotificationsInput,
      ),
    );

  getNotification = async (req: Request, res: Response) =>
    respond(
      res,
      await this.notificationsService.get(
        requireTenantId(req),
        req.user!.id,
        String(req.params.notificationId),
      ),
    );

  markNotificationRead = async (req: Request, res: Response) =>
    respond(
      res,
      await this.notificationsService.markRead(
        requireTenantId(req),
        req.user!.id,
        String(req.params.notificationId),
      ),
    );
}
