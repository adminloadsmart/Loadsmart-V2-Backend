import { z } from 'zod';
import { DOCUMENT_NUMBER_REGEX } from './organization.constants';
import { ORGANIZATION_DOCUMENT_TYPES } from './entities/organization-document.entity';

const organizationDocumentSchema = z
  .object({
    documentType: z.enum(ORGANIZATION_DOCUMENT_TYPES),
    documentNumber: z.string().trim().min(1).optional(),
    documentUrl: z.string().trim().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.documentNumber && !data.documentUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentNumber'],
        message: 'Either documentNumber or documentUrl is required',
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

const organizationReviewSchema = z
  .object({
    step: z.literal('review_submit'),
    companyLegalName: z.string().min(1),
    contactPersonName: z.string().min(1),
    operatingCity: z.string().min(1),
    ownsFleet: z.boolean(),
    fleetSize: z.number().int().positive().optional(),
    referralCode: z.string().min(1).optional(),
    registeredBusinessName: z.string().min(1),
    registrationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'registrationDate must be in YYYY-MM-DD format')
      .optional(),
    address: z.object({
      addressLine1: z.string().min(1),
      addressLine2: z.string().min(1).optional(),
      city: z.string().min(1),
      district: z.string().min(1),
      state: z.string().min(1),
      pinCode: z.string().min(1),
    }),
    documents: z.array(organizationDocumentSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.ownsFleet && data.fleetSize === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['fleetSize'],
        message: 'fleetSize is required when ownsFleet is true',
      });
    }
    const types = data.documents.map((document) => document.documentType);
    if (new Set(types).size !== types.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'Each document type may only be submitted once',
      });
    }
  });

export const organizationValidators = {
  createOrganization: z.object({
    body: z
      .object({
        companyLegalName: z.string().min(1),
        contactPersonName: z.string().min(1),
        operatingCity: z.string().min(1),
        ownsFleet: z.boolean(),
        fleetSize: z.number().int().positive().optional(),
        referralCode: z.string().min(1).optional(),
      })
      .superRefine((data, ctx) => {
        if (data.ownsFleet) {
          if (data.fleetSize === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['fleetSize'],
              message: 'fleetSize is required when ownsFleet is true',
            });
          }
        }
      }),
  }),
  saveBusinessDetails: z.object({
    body: z
      .object({
        registeredBusinessName: z.string().min(1),
        registrationDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'registrationDate must be in YYYY-MM-DD format')
          .optional(),
        address: z.object({
          addressLine1: z.string().min(1),
          addressLine2: z.string().min(1).optional(),
          city: z.string().min(1),
          district: z.string().min(1),
          state: z.string().min(1),
          pinCode: z.string().min(1),
        }),
        documents: z.array(organizationDocumentSchema).optional(),
      })
      .superRefine((data, ctx) => {
        if (data.documents) {
          const types = data.documents.map((document) => document.documentType);
          if (new Set(types).size !== types.length) {
            ctx.addIssue({
              code: 'custom',
              path: ['documents'],
              message: 'Each document type may only be submitted once',
            });
          }
        }
      }),
  }),
  submitOrganization: z.object({
    body: organizationReviewSchema,
  }),
};
