import { z } from 'zod';
import { DOCUMENT_NUMBER_REGEX } from './auth.constants';
import { ORGANIZATION_DOCUMENT_TYPES } from './entities/organization-document.entity';

const organizationDocumentSchema = z
  .object({
    documentType: z.enum(ORGANIZATION_DOCUMENT_TYPES),
    documentNumber: z.string().min(1).optional(),
    fileKey: z.string().min(1).optional(),
    // Self-declared, as printed on this specific document (e.g. GST legal name & registered
    // address, PAN/Aadhaar holder name & DOB) — none required, since not every field applies to
    // every document type (dob only makes sense for individual-linked documents).
    registeredName: z.string().min(1).optional(),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be in YYYY-MM-DD format')
      .optional(),
    addressLine1: z.string().min(1).optional(),
    addressLine2: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    district: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    pinCode: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.documentNumber && !data.fileKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentNumber'],
        message: 'Either documentNumber or fileKey is required',
      });
      return;
    }
    const regex = DOCUMENT_NUMBER_REGEX[data.documentType];
    if (data.documentNumber && regex && !regex.test(data.documentNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentNumber'],
        message: `Invalid ${data.documentType} number format`,
      });
    }
  });

export const authValidators = {
  signup: z.object({
    body: z.object({
      phoneNumber: z.string().min(10),
    }),
  }),
  verifyOtp: z.object({
    body: z.object({
      otp: z.string().length(6),
    }),
  }),
  login: z.object({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  }),
  refresh: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
  logout: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
  createOrganization: z.object({
    body: z
      .object({
        // Required on first-time submission (sets the org_admin's login credentials — see
        // auth.service.ts's createOrganization), ignored on later profile updates. Kept optional
        // here since tenantId (which distinguishes create from update) isn't in the request body
        // at all — the required-on-create check has to live in the service layer.
        email: z.string().email().optional(),
        password: z.string().min(8).optional(),
        name: z.string().min(1),
        companyLegalName: z.string().min(1),
        orgAdminName: z.string().min(1),
        operationalCity: z.string().min(1),
        addressLine1: z.string().min(1),
        addressLine2: z.string().min(1).optional(),
        city: z.string().min(1),
        district: z.string().min(1),
        state: z.string().min(1),
        hasOwnFleet: z.boolean(),
        fleetSize: z.number().int().positive().optional(),
        documents: z.array(organizationDocumentSchema).optional(),
        // Optional — attributes this org to a sales rep's code at signup. Format checked here;
        // existence/validity is a lookup, so that's checked service-side (see
        // ReferralCodeService.validateAndResolve).
        referralCode: z.string().min(1).optional(),
      })
      .superRefine((data, ctx) => {
        if (data.hasOwnFleet) {
          if (data.fleetSize === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['fleetSize'],
              message: 'fleetSize is required when hasOwnFleet is true',
            });
          }
          return;
        }

        if (!data.documents || data.documents.length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['documents'],
            message:
              'At least one document (gst_certificate, pan, udyam, aadhaar, cin, or shop_establishment) is required when hasOwnFleet is false',
          });
          return;
        }

        const types = data.documents.map((document) => document.documentType);
        if (new Set(types).size !== types.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['documents'],
            message: 'Each document type may only be submitted once',
          });
        }
      }),
  }),
};
