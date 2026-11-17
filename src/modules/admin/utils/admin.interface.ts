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
  status?: OrganizationStatus[];
  excludeDrafts?: boolean;
  journeyStage?: OrganizationJourneyStage;
  search?: string;
  filter?: DateFilter;
  from?: string;
  to?: string;
}

/** The business-registration number shown under a company in the verification queue: GST, else
 *  CIN/Udyam/shop licence (BUSINESS_DOCUMENT_ORDER). */
export interface OrganizationBusinessDocument {
  documentType: OrganizationDocumentType;
  documentNumber: string | null;
}

export type OrganizationsSummaryInput = Pick<
  ListOrganizationsInput,
  'search' | 'filter' | 'from' | 'to'
>;

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
  // Matches name, email, phone or employee ID.
  search?: string;
  // The team (auth role name). `role` is the pre-teams name for the same filter, still accepted
  // so the KYC assignee dropdowns keep working; `team` wins when both are sent.
  team?: string;
  role?: string;
  teamRole?: string;
  region?: string;
  // invited = never signed in (lastSignedInAt null); active = has signed in.
  status?: 'invited' | 'active';
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
  // null clears the expiry.
  validUntil?: string | null;
}

export interface SetReferralCodeStatusInput {
  status: 'active' | 'revoked';
}

export type StaffParams = { staffId: string };
