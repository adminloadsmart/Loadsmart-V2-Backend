import { Request } from 'express';
import { hasPermission } from '../../../shared/middleware/require-permission.middleware';
import { MAINTENANCE_COSTS_VIEW } from '../../../shared/constants/permissions';

/**
 * Money on the maintenance screen — the spend and downtime headlines and every cost field on a
 * job — only goes to a seat holding MAINTENANCE_COSTS_VIEW (platform_admin always, same implicit
 * bypass as requirePermission). Everything else on the screen goes to every tenant seat: the
 * person booking the jobs is usually not the person who sees what they cost.
 */
export function canSeeMaintenanceCosts(req: Request): boolean {
  return hasPermission(req.user, MAINTENANCE_COSTS_VIEW);
}
