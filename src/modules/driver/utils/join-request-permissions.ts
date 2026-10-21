import { Request } from 'express';
import { PLATFORM_ADMIN_ROLE } from '../../../shared/constants/roles';
import { MASTERS_APPROVE } from '../../../shared/constants/permissions';

/**
 * Whether the caller may approve/reject — and so restore — driver join requests: the same check
 * requirePermission(MASTERS_APPROVE) makes on those routes (platform_admin always passes). Decides
 * Recently Rejected's `canRestore`.
 */
export function canApproveJoinRequests(req: Request): boolean {
  const user = req.user;
  if (!user) return false;
  return user.role === PLATFORM_ADMIN_ROLE || user.permissions.includes(MASTERS_APPROVE);
}
