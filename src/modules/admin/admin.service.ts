import { OrganizationService } from '../auth/organization.service';
import { OrganizationDocumentService } from '../auth/organization-document.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { paginate } from './utils/admin.types';
import {
  ListOrganizationsInput,
  ListStaffInput,
  UpdateOrganizationInput,
  VerifyOrganizationDocumentInput,
} from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';

export class AdminService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly authService: AuthService,
  ) { }

  async listOrganizations(input: ListOrganizationsInput) {
    const { items, total } = await this.organizationService.listOrganizations(input);
    return paginate(items, total, input);
  }

  async getOrganization(organizationId: string) {
    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(organizationId),
      this.organizationDocumentService.listByOrganization(organizationId),
    ]);
    return { ...organization, documents };
  }

  updateOrganization(organizationId: string, input: UpdateOrganizationInput) {
    return this.organizationService.updateOrganization(organizationId, input);
  }

  verifyOrganizationDocument(
    actingUser: AuthenticatedUser,
    organizationId: string,
    documentId: string,
    input: VerifyOrganizationDocumentInput,
  ) {
    return this.organizationDocumentService.updateVerificationStatus(organizationId, documentId, actingUser.id, input);
  }

  createStaff(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    return this.authService.createStaffUser(actingUser, input);
  }

  listStaff(input: ListStaffInput) {
    return this.authService.listStaffUsers(input);
  }
}
