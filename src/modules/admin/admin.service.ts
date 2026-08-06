import { OrganizationService } from '../auth/organization.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { paginate } from './utils/admin.types';
import { ListOrganizationsInput, ListStaffInput, UpdateOrganizationInput } from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';

export class AdminService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly authService: AuthService,
  ) { }

  async listOrganizations(input: ListOrganizationsInput) {
    const { items, total } = await this.organizationService.listOrganizations(input);
    return paginate(items, total, input);
  }

  getOrganization(organizationId: string) {
    return this.organizationService.getOrganizationStatus(organizationId);
  }

  updateOrganization(organizationId: string, input: UpdateOrganizationInput) {
    return this.organizationService.updateOrganization(organizationId, input);
  }

  createStaff(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    return this.authService.createStaffUser(actingUser, input);
  }

  listStaff(input: ListStaffInput) {
    return this.authService.listStaffUsers(input);
  }
}
