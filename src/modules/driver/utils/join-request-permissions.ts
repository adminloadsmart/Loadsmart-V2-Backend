import { Request } from 'express';
import { hasPermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_APPROVE } from '../../../shared/constants/permissions';

/**
 * Whether the caller may approve/reject — and so restore — driver join requests: the same check
 * requirePermission(MASTERS_APPROVE) makes on those routes (platform_admin always passes). Decides
 * Recently Rejected's `canRestore`.
 */
export function canApproveJoinRequests(req: Request): boolean {
  return hasPermission(req.user, MASTERS_APPROVE);
}
