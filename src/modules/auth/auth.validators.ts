import { z } from 'zod';
import { GSTIN_REGEX } from './auth.constants';

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
        gstin: z.string().regex(GSTIN_REGEX).optional(),
        documentUrl: z.string().min(1).optional(),
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
        } else if (!data.gstin && !data.documentUrl) {
          ctx.addIssue({
            code: 'custom',
            path: ['gstin'],
            message: 'Either gstin or documentUrl is required when hasOwnFleet is false',
          });
        }
      }),
  }),
};
