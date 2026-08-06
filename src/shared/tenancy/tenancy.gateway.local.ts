import { AuthorizationError } from '../errors';
import { OrganizationService } from '../../modules/auth/organization.service';
import { isTenantAccessible } from '../../modules/auth/organization.constants';
import { TenancyGateway } from './tenancy.gateway';

export class TenancyGatewayLocal implements TenancyGateway {
  constructor(private readonly organizationService: OrganizationService) { }

  async assertTenantActive(tenantId: string): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(tenantId);
    if (!isTenantAccessible(organization.status)) {
      throw new AuthorizationError(`Organization is ${organization.status} and cannot access this resource`);
    }
  }
}
