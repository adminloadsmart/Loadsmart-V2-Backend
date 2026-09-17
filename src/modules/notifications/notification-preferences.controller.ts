import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import {
  NotificationPreferencesService,
  UpdateNotificationPreferenceInput,
} from './notification-preferences.service';

/** Org-wide settings ("Choose how your team gets alerted") — scoped by tenant, not by the
 *  calling user. GET is open to any authenticated org member; PUT/reset are org_admin-only,
 *  enforced in the service via the caller's role. */
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

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
}
