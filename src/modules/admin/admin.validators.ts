import { z } from 'zod';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './admin.constants';
import {
  ORGANIZATION_JOURNEY_STAGES,
  ORGANIZATION_STATUSES,
} from '../organization/entities/organization.entity';
import { STAFF_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import { REFERRAL_CODE_REGEX } from '../organization/organization.constants';
import { DATE_FILTERS } from '../../shared/utils/date-filter';

const uuid = z.string().uuid();
const organizationParams = z.object({ organizationId: uuid });
const organizationDocumentParams = organizationParams.extend({ documentId: uuid });
const decisionReasonBody = z.object({ reason: z.string().min(1) });
const referralCodeParams = z.object({ referralCodeId: uuid });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format');

const pagination = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().min(1).optional(),
});

export const adminValidators = {
  listOrganizations: z.object({
    query: pagination
      .extend({
        status: z.enum(ORGANIZATION_STATUSES).optional(),
        journeyStage: z.enum(ORGANIZATION_JOURNEY_STAGES).optional(),
        filter: z.enum(DATE_FILTERS).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .superRefine((data, ctx) => {
        if (data.filter === 'custom' && (!data.from || !data.to)) {
          ctx.addIssue({
            code: 'custom',
            path: ['from'],
            message: 'from and to are required when filter is custom',
          });
        }
        if (data.from && data.to && data.from > data.to) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: 'to must be on/after from',
          });
        }
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
  listStaff: z.object({
    query: pagination.extend({ role: z.enum(STAFF_ASSIGNABLE_ROLES).optional() }),
  }),

  // ownerUserId's role match (must be 'sales') can't be expressed at the schema level — see
  // admin.service.ts's createReferralCode.
  createReferralCode: z.object({
    body: z
      .object({
        code: z.string().regex(REFERRAL_CODE_REGEX, 'Invalid referral code format'),
        ownerUserId: uuid,
        validFrom: isoDate.optional(),
        validUntil: isoDate.optional(),
      })
      .superRefine((data, ctx) => {
        if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
          ctx.addIssue({
            code: 'custom',
            path: ['validUntil'],
            message: 'validUntil must be on/after validFrom',
          });
        }
      }),
  }),
  listReferralCodes: z.object({ query: pagination.extend({ ownerUserId: uuid.optional() }) }),
  getReferralCode: z.object({ params: referralCodeParams }),
  // Cross-field validFrom/validUntil ordering is only fully checked here when both are present in
  // the same request — if only one is supplied, the merge against the existing stored value is
  // checked service-side (see ReferralCodeService.update).
  updateReferralCode: z.object({
    params: referralCodeParams,
    body: z
      .object({
        ownerUserId: uuid.optional(),
        validFrom: isoDate.optional(),
        validUntil: isoDate.optional(),
      })
      .superRefine((data, ctx) => {
        if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
          ctx.addIssue({
            code: 'custom',
            path: ['validUntil'],
            message: 'validUntil must be on/after validFrom',
          });
        }
      }),
  }),
  revokeReferralCode: z.object({ params: referralCodeParams }),
  // Hard delete — blocked service-side (AdminService.deleteReferralCode) if any organization has
  // already redeemed the code.
  deleteReferralCode: z.object({ params: referralCodeParams }),
};
