import { OrganizationStatus } from '../../auth/entities/organization.entity';
import { DocumentVerificationStatus } from '../../auth/entities/organization-document.entity';
import { PaginationInput } from './admin.types';

export interface ListOrganizationsInput extends PaginationInput {
  status?: OrganizationStatus;
  search?: string;
}

export interface UpdateOrganizationInput {
  status: OrganizationStatus;
}

export interface VerifyOrganizationDocumentInput {
  verificationStatus: DocumentVerificationStatus;
}

export type OrganizationParams = { organizationId: string };
export type OrganizationDocumentParams = { organizationId: string; documentId: string };

export interface ListStaffInput extends PaginationInput {
  search?: string;
}
