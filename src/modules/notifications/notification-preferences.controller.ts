import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import {
  NotificationPreferencesService,
  UpdateNotificationPreferenceInput,
} from './notification-preferences.service';
import { QuietHoursSetting, UpdateMyNotificationPreferenceInput } from './notifications.interface';

/** Settings → Notifications. The *My* handlers act on the calling user only; the organisation
 *  handlers (getPreferences/updatePreferences/resetToDefault, quiet hours) act on the caller's
 *  tenant — GET open to any org member, writes org_admin-only (enforced in the service). */
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  getMyPreferences = async (req: Request, res: Response) =>
    respond(res, await this.service.getMyPreferences(requireTenantId(req), req.user!.id));

  updateMyPreferences = async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    const { items } = req.body as { items: UpdateMyNotificationPreferenceInput[] };
    await this.service.updateMyPreferences(tenantId, req.user!.id, items);
    respond(res, await this.service.getMyPreferences(tenantId, req.user!.id));
  };

  resetMyPreferences = async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    await this.service.resetMyPreferences(tenantId, req.user!.id);
    respond(res, await this.service.getMyPreferences(tenantId, req.user!.id));
  };

  getPreferences = async (req: Request, res: Response) =>
    respond(res, await this.service.getPreferences(requireTenantId(req)));

  updatePreferences = async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    const { items } = req.body as { items: UpdateNotificationPreferenceInput[] };
    await this.service.updatePreferences(tenantId, req.user!.role, items);
    respond(res, await this.service.getPreferences(tenantId));
  };

  resetToDefault = async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    await this.service.resetToDefault(tenantId, req.user!.role);
    respond(res, await this.service.getPreferences(tenantId));
  };

  getQuietHours = async (req: Request, res: Response) =>
    respond(res, await this.service.getQuietHours(requireTenantId(req)));

  updateQuietHours = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.updateQuietHours(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body as QuietHoursSetting,
      ),
    );
}
