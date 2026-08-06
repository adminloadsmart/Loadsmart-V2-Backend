import { GstinVerificationStatus, OrganizationStatus } from '../../auth/entities/organization.entity';
import { PaginationInput } from './admin.types';

export interface ListOrganizationsInput extends PaginationInput {
  status?: OrganizationStatus;
  search?: string;
}

export interface UpdateOrganizationInput {
  status?: OrganizationStatus;
  gstinVerificationStatus?: GstinVerificationStatus;
}

export type OrganizationParams = { organizationId: string };

export interface ListStaffInput extends PaginationInput {
  search?: string;
}
