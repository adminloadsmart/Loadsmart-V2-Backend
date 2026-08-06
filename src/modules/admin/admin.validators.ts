import { z } from 'zod';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './admin.constants';
import { ORGANIZATION_STATUSES } from '../auth/entities/organization.entity';

const uuid = z.string().uuid();
const organizationParams = z.object({ organizationId: uuid });
const organizationDocumentParams = organizationParams.extend({ documentId: uuid });

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
  listStaff: z.object({ query: pagination }),
};
