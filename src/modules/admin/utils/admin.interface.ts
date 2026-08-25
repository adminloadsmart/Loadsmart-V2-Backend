import {
  OrganizationJourneyStage,
  OrganizationStatus,
} from '../../organization/entities/organization.entity';
import {
  DocumentVerificationStatus,
  OrganizationDocumentType,
} from '../../organization/entities/organization-document.entity';
import { DateFilter } from '../../../shared/utils/date-filter';
import { PaginationInput } from './admin.types';

export interface ListOrganizationsInput extends PaginationInput {
  status?: OrganizationStatus;
  journeyStage?: OrganizationJourneyStage;
  search?: string;
  filter?: DateFilter;
  from?: string;
  to?: string;
}

export interface UpdateOrganizationInput {
  status: OrganizationStatus;
  reason: string;
}

export interface VerifyOrganizationDocumentInput {
  verificationStatus: DocumentVerificationStatus;
  reason?: string;
}

// Admin/reviewer-driven attach-or-replace — see admin.service.ts's uploadOrganizationDocument.
// fileKey/backFileKey reference an already-uploaded, already-confirmed file (via POST /files +
// POST /files/:fileId/confirm), not raw bytes — this endpoint never handles a multipart body.
export interface UploadOrganizationDocumentInput {
  documentType: OrganizationDocumentType;
  documentNumber?: string;
  fileKey: string;
  backFileKey?: string;
}

export interface AssignReviewerInput {
  userId: string;
}

export interface OrganizationDecisionReasonInput {
  reason: string;
}

export type OrganizationParams = { organizationId: string };
export type OrganizationDocumentParams = { organizationId: string; documentId: string };

export interface ListStaffInput extends PaginationInput {
  search?: string;
  role?: string;
}

export interface CreateReferralCodeInput {
  code: string;
  ownerUserId?: string;
  validUntil?: string;
}

export interface ListReferralCodesInput extends PaginationInput {
  ownerUserId?: string;
  search?: string;
}

export type ReferralCodeParams = { referralCodeId: string };

export interface UpdateReferralCodeInput {
  ownerUserId?: string;
  validUntil?: string;
}

export interface SetReferralCodeStatusInput {
  status: 'active' | 'revoked';
}

export type StaffParams = { staffId: string };
