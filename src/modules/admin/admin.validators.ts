import { z } from 'zod';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './admin.constants';
import { ORGANIZATION_STATUSES } from '../auth/entities/organization.entity';
import { STAFF_ASSIGNABLE_ROLES } from '../../shared/constants/roles';

const uuid = z.string().uuid();
const organizationParams = z.object({ organizationId: uuid });
const organizationDocumentParams = organizationParams.extend({ documentId: uuid });
const decisionReasonBody = z.object({ reason: z.string().min(1) });

const pagination = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().min(1).optional(),
});

export const adminValidators = {
  listOrganizations: z.object({
    query: pagination.extend({
      status: z.enum(ORGANIZATION_STATUSES).optional(),
    }),
  }),
  getOrganization: z.object({ params: organizationParams }),

  updateOrganization: z.object({
    params: organizationParams,
    body: z.object({
      status: z.enum(ORGANIZATION_STATUSES),
    }),
  }),

  // Verifies/rejects one specific submitted document — separate from updateOrganization above,
  // which only ever touches the org's own status now. See organization-document.entity.ts for the
  // document-type/verification-status value sets.
  verifyOrganizationDocument: z.object({
    params: organizationDocumentParams,
    body: z.object({
      verificationStatus: z.enum(['pending', 'verified', 'invalid']),
    }),
  }),

  // Record-keeping/routing assignment — see admin.service.ts's assignReviewer for the role check
  // (online_kyc_desk / offline_kyc_desk respectively) this can't express at the schema level.
  assignOnlineVerifier: z.object({
    params: organizationParams,
    body: z.object({ userId: uuid }),
  }),
  assignPhysicalAgent: z.object({
    params: organizationParams,
    body: z.object({ userId: uuid }),
  }),

  approveOrganization: z.object({ params: organizationParams }),
  // Reason is mandatory on both — Reject's is meant to be one of the frontend's canned template
  // strings, Deny's free text, but that distinction is a frontend concern; the schema just
  // requires a non-empty reason either way.
  rejectOrganization: z.object({ params: organizationParams, body: decisionReasonBody }),
  denyOrganization: z.object({ params: organizationParams, body: decisionReasonBody }),

  getOrganizationAuditTrail: z.object({ params: organizationParams, query: pagination }),

  createStaff: z.object({
    body: z.object({
      fullName: z.string().min(1),
      phoneNumber: z.string().min(10),
      email: z.string().email(),
      roleId: uuid,
      coverage: z.string().min(1),
      permissionIds: z.array(uuid).optional(),
    }),
  }),
  // role narrows to eligible staff for the KYC assignment dropdowns (see auth.repository.ts's
  // listStaffUsers) — same enum the staff-creation roleId is ultimately validated against.
  listStaff: z.object({ query: pagination.extend({ role: z.enum(STAFF_ASSIGNABLE_ROLES).optional() }) }),
};
