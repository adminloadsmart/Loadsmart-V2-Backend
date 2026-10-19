import { z } from 'zod';
import { ORGANIZATION_DOCUMENT_TYPES } from './entities/organization-document.entity';
import { ORG_ADMIN_ROLE, ORG_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import { paginationQuery as pagination } from '../../shared/validators/pagination';

const uuid = z.string().uuid();

const addressSchema = z.object({
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().min(1).optional(),
  landmark: z.string().trim().min(1).optional(),
  areaLocality: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  pinCode: z.string().regex(/^\d{6}$/, 'PIN Code must be exactly 6 digits'),
});

const documentType = z.enum(ORGANIZATION_DOCUMENT_TYPES);
const storageKeys = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]);
const registeredAddressSchema = z.object({
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  pinCode: z.string().regex(/^\d{6}$/, 'PIN Code must be exactly 6 digits'),
});

const multipartRegisteredAddressSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, registeredAddressSchema);

const organizationUserFilters = {
  role: z.enum([ORG_ADMIN_ROLE, ...ORG_ASSIGNABLE_ROLES] as [string, ...string[]]).optional(),
  status: z.enum(['active', 'invited']).optional(),
};

export const organizationValidators = {
  createOrganization: z.object({
    body: z.object({
      companyLegalName: z.string().min(1),
      ownsFleet: z.boolean(),
      address: addressSchema,
      referralCode: z.string().min(1).optional(),
    }),
  }),
  saveBusinessDetails: z.object({
    body: z.object({
      documentType,
      documentNo: z.string().trim().min(1).optional(),
      replaceDocumentType: documentType.optional(),
      documentFront: storageKeys.optional(),
      shopPremisesPhoto: z.string().trim().min(1).optional(),
      registeredAddress: multipartRegisteredAddressSchema.optional(),
    }),
  }),
  submitOrganization: z.object({
    body: z.object({
      step: z.literal('review_submit'),
      referralCode: z.string().trim().min(1).optional(),
    }),
  }),

  // Settings → Users & Roles "Invite a teammate". roleId is just a uuid here — the actual
  // ORG_ASSIGNABLE_ROLES membership check happens service-side (auth.service.ts's
  // inviteOrganizationUser), same as admin.validators.ts's createStaff/STAFF_ASSIGNABLE_ROLES.
  inviteOrganizationUser: z.object({
    body: z.object({
      fullName: z.string().trim().min(1),
      // Work email from the redesigned "Invite a User" drawer.
      email: z.string().trim().email().max(255),
      // Still required: every login path is phone-based (see auth.types.ts).
      phoneNumber: z.string().min(10),
      roleId: uuid,
      basedAtLoadingPointId: uuid.nullable().optional(),
    }),
  }),
  // role narrows to a specific teammate role for the table's filter — same enum the invite
  // roleId is ultimately validated against. org_admin is listable too (it shows in the table).
  listOrganizationUsers: z.object({
    query: pagination.extend(organizationUserFilters),
  }),
  exportOrganizationUsers: z.object({
    query: z.object({ search: z.string().min(1).optional(), ...organizationUserFilters }),
  }),
  changeOrganizationUserSeat: z.object({
    params: z.object({ userId: uuid }),
    body: z
      .object({
        roleId: uuid.optional(),
        basedAtLoadingPointId: uuid.nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
  }),
  removeOrganizationUser: z.object({ params: z.object({ userId: uuid }) }),
};
