import { OrganizationStatus } from './entities/organization.entity';

// Allow-list, not deny-list: onboarding states (pending/partial_pending/draft) must stay
// accessible — the org still needs to hit POST /auth/organization to finish its profile. Only
// rejected/suspended actually block API access. Any future status defaults to blocked (fails
// closed) simply by not being added here.
export const TENANT_ACCESSIBLE_STATUSES: readonly OrganizationStatus[] = ['active', 'pending', 'partial_pending', 'draft'];

export function isTenantAccessible(status: OrganizationStatus): boolean {
  return TENANT_ACCESSIBLE_STATUSES.includes(status);
}
