import { AuthorizationError } from '../errors';
import { OrganizationService } from '../../modules/organization/organization.service';
import {
  isTenantAccessible,
  isTenantWriteAccessible,
} from '../../modules/organization/organization.constants';
import { API_VERSION_PREFIX } from '../constants/api';
import { TenancyGateway } from './tenancy.gateway';

// Methods that only read state. Everything else (POST/PUT/PATCH/DELETE, ...) is treated as a
// write and additionally requires the org to be fully approved — see isTenantWriteAccessible.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Storage upload endpoints org_admin must be able to reach while onboarding (org status
// draft/pending/partial_pending, not yet approved) — e.g. uploading business/KYC documents via
// the generic /files flow. Only these two writes are exempt from the approval gate below; every
// other write on every other router, and DELETE /files/:fileId itself, still requires
// isTenantWriteAccessible (i.e. an active org). See storage.routes.ts for the route definitions.
// req.path here is the real incoming path INCLUDING the API_VERSION_PREFIX ('/v1/files', ...) —
// createTenantScope runs ahead of the versioned router mounts in app.ts, not behind them — so the
// exemption patterns must include that same prefix or they silently never match.
const UPLOAD_PATH = `${API_VERSION_PREFIX}/files`;
const WRITE_APPROVAL_EXEMPT_ROUTES: ReadonlyArray<{ method: string; test: RegExp }> = [
  { method: 'POST', test: new RegExp(`^${UPLOAD_PATH}/?$`) },
  { method: 'POST', test: new RegExp(`^${UPLOAD_PATH}/[^/]+/confirm/?$`) },
];

function isWriteApprovalExempt(method: string, path: string): boolean {
  return WRITE_APPROVAL_EXEMPT_ROUTES.some(
    (route) => route.method === method && route.test.test(path),
  );
}

export class TenancyGatewayLocal implements TenancyGateway {
  constructor(private readonly organizationService: OrganizationService) {}

  async assertTenantActive(tenantId: string, method: string, path: string): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(tenantId);
    if (!isTenantAccessible(organization.status)) {
      throw new AuthorizationError(
        `Organization is ${organization.status} and cannot access this resource`,
        { reason: 'ORGANIZATION_NOT_ACCESSIBLE', status: organization.status },
      );
    }

    if (
      !SAFE_METHODS.has(method) &&
      !isWriteApprovalExempt(method, path) &&
      !isTenantWriteAccessible(organization.status)
    ) {
      throw new AuthorizationError(
        `Organization is ${organization.status} and cannot make changes until it is approved`,
        { reason: 'ORGANIZATION_NOT_APPROVED', status: organization.status },
      );
    }
  }
}
