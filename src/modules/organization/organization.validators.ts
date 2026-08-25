import { z } from 'zod';
import { ORGANIZATION_DOCUMENT_TYPES } from './entities/organization-document.entity';
import { ORG_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
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
      fullName: z.string().min(1),
      phoneNumber: z.string().min(10),
      roleId: uuid,
    }),
  }),
  // role narrows to a specific teammate role for the table's filter — same enum the invite
  // roleId is ultimately validated against.
  listOrganizationUsers: z.object({
    query: pagination.extend({ role: z.enum(ORG_ASSIGNABLE_ROLES).optional() }),
  }),
};
