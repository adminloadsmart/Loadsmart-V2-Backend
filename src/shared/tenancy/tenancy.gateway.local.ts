import { AuthorizationError } from '../errors';
import { OrganizationService } from '../../modules/organization/organization.service';
import {
  isTenantAccessible,
  isTenantWriteAccessible,
} from '../../modules/organization/organization.constants';
import { TenancyGateway } from './tenancy.gateway';

// Methods that only read state. Everything else (POST/PUT/PATCH/DELETE, ...) is treated as a
// write and additionally requires the org to be fully approved — see isTenantWriteAccessible.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class TenancyGatewayLocal implements TenancyGateway {
  constructor(private readonly organizationService: OrganizationService) {}

  async assertTenantActive(tenantId: string, method: string): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(tenantId);
    if (!isTenantAccessible(organization.status)) {
      throw new AuthorizationError(
        `Organization is ${organization.status} and cannot access this resource`,
        { reason: 'ORGANIZATION_NOT_ACCESSIBLE', status: organization.status },
      );
    }

    if (!SAFE_METHODS.has(method) && !isTenantWriteAccessible(organization.status)) {
      throw new AuthorizationError(
        `Organization is ${organization.status} and cannot make changes until it is approved`,
        { reason: 'ORGANIZATION_NOT_APPROVED', status: organization.status },
      );
    }
  }
}
