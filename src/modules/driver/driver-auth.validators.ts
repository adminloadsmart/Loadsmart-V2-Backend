import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../shared/utils/date';
import { IFSC_REGEX } from '../masters/masters.constants';
import {
  DRIVER_BLOOD_GROUPS,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_DOCUMENT_VERIFICATION_SOURCES,
  DRIVER_ONBOARDING_STEPS,
} from './drivers.types';

// Same convention as modules/auth/auth.validators.ts's deviceTokenFields — optional on every
// session-issuing endpoint below, deviceType required alongside fcmToken via .superRefine. No
// ipAddress field — always derived server-side from req.ip.
const deviceTokenFields = {
  fcmToken: z.string().trim().min(1).max(512).optional(),
  deviceType: z.enum(['ios', 'android', 'web']).optional(),
  deviceInfo: z.string().trim().max(255).optional(),
};

const requireDeviceType = (
  data: { fcmToken?: string; deviceType?: string },
  ctx: z.RefinementCtx,
) => {
  if (data.fcmToken && !data.deviceType) {
    ctx.addIssue({
      code: 'custom',
      path: ['deviceType'],
      message: 'deviceType is required when fcmToken is provided',
    });
  }
};

const licenseNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => value.length >= 8 && value.length <= 30, 'Invalid driving licence number');

const registerDocumentBody = z.object({
  documentType: z.enum(DRIVER_DOCUMENT_TYPES),
  fileUrl: z.string().min(1),
  documentNumber: z.string().min(1).max(50).optional(),
  verificationSource: z.enum(DRIVER_DOCUMENT_VERIFICATION_SOURCES).optional(),
});

const relationParams = z.object({ relationId: z.string().uuid() });

export const driverAuthValidators = {
  // --- Login ---
  requestOtp: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
    }),
  }),
  verifyOtp: z.object({
    body: z
      .object({
        otp: z.string().length(4, 'OTP must be 4 digits long'),
        ...deviceTokenFields,
      })
      .superRefine(requireDeviceType),
  }),
  selectTenant: z.object({
    body: z
      .object({
        tenantId: z.string().uuid(),
        ...deviceTokenFields,
      })
      .superRefine(requireDeviceType),
  }),
  refresh: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
  // No `logout` validator — the route takes no body at all, same convention as
  // modules/auth/auth.validators.ts.
  updateDeviceToken: z.object({
    body: z
      .object({
        fcmToken: z.string().trim().min(1).max(512),
        deviceType: z.enum(['ios', 'android', 'web']),
      })
      .strict(),
  }),
  selectRelation: z.object({
    body: z
      .object({
        relationId: z.string().uuid(),
        ...deviceTokenFields,
      })
      .superRefine(requireDeviceType),
  }),

  // --- Self-registration ---
  requestRegisterOtp: z.object({
    body: z.object({ phoneNumber: z.string().trim().min(10) }),
  }),
  verifyRegisterOtp: z.object({
    body: z
      .object({
        otp: z.string().length(4, 'OTP must be 4 digits long'),
        ...deviceTokenFields,
      })
      .superRefine(requireDeviceType),
  }),
  // Screen 1 (mandatory): fullName, licenseNumber, dateOfBirth, documents. Screens 2/3
  // (optional): bloodGroup, emergency contact (+ relation), hasLifeInsurance, hasHealthInsurance, bankDetails. No
  // deviceTokenFields here — the session was already issued by verifyRegisterOtp (or a resumed
  // login), not this call. Kept as optional extras, not part of any screen but not removed:
  // licenseExpiry, addressLine1/2, city, pinCode.
  //
  // `documents` is optional here, not `.min(1)` — this call is resumable (see
  // driver-identity.service.ts's completeRegistration), so a driver who already uploaded photos
  // on a prior call shouldn't have to resend them just to add screen 2/3 fields. "Both
  // driving_license_front and driving_license_back, cumulatively across calls" is enforced in
  // the service instead of here — always required, regardless of Sarathi's verification result.
  register: z.object({
    body: z.object({
      fullName: z.string().min(1).max(150),
      licenseNumber,
      dateOfBirth: isoDate,
      documents: z.array(registerDocumentBody).max(10).optional(),
      bloodGroup: z.enum(DRIVER_BLOOD_GROUPS).optional(),
      emergencyContactName: z.string().min(1).max(150).optional(),
      emergencyContactPhone: z
        .string()
        .trim()
        .transform((value) => value.replace(/[\s-]/g, ''))
        .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number')
        .optional(),
      emergencyContactRelation: z.string().min(1).max(50).optional(),
      hasHealthInsurance: z.boolean().optional(),
      hasLifeInsurance: z.boolean().optional(),
      bankDetails: z
        .object({
          accountNumber: z.string().min(6).max(30),
          ifsc: z
            .string()
            .trim()
            .transform((value) => value.toUpperCase())
            .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code'),
          accountHolderName: z.string().min(1).max(150).optional(),
          upiId: z
            .string()
            .trim()
            .toLowerCase()
            .refine((value) => /^[a-z0-9.\-_]{2,50}@[a-z]{2,50}$/.test(value), 'Invalid UPI id')
            .optional(),
        })
        .optional(),
      licenseExpiry: isoDate.optional(),
      addressLine1: z.string().min(1).max(255).optional(),
      addressLine2: z.string().min(1).max(255).optional(),
      city: z.string().min(1).max(100).optional(),
      pinCode: z
        .string()
        .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
        .optional(),
      // Resume-position bookmark — the client reports which screen it just completed/is on.
      // Not validated for forward-only ordering; it's a UI hint, not an enforced business rule.
      onboardingStep: z.enum(DRIVER_ONBOARDING_STEPS).optional(),
    }),
  }),

  // Step-1 preflight, mirroring masters/driver.validators.ts's verifyDriverDl.
  verifyDl: z.object({
    body: z.object({
      licenseNumber,
      dateOfBirth: isoDate,
    }),
  }),

  // Tenant-less upload handshake for the driver's own DL photos — mirrors
  // driver-portal.validators.ts's requestUploadUrl/confirmUpload, but locked to the single
  // `masters/driver` purpose (no trips/pod or loads/issue here — those need a tenant, unlike
  // registration).
  requestUploadUrl: z.object({
    body: z
      .object({
        purpose: z.literal('masters/driver'),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(255),
        sizeBytes: z.coerce.number().int().positive(),
      })
      .strict(),
  }),
  confirmUpload: z.object({ params: z.object({ fileId: z.string().uuid() }) }),

  // --- Cross-tenant relation management ---
  requestJoin: z.object({
    body: z.object({ tenantId: z.string().uuid() }),
  }),
  acceptInvite: z.object({ params: relationParams }),
  rejectInvite: z.object({
    params: relationParams,
    body: z.object({ reason: z.string().trim().min(1).max(500).optional() }),
  }),
  searchOrganizations: z.object({
    query: z.object({ q: z.string().trim().min(2).max(150) }),
  }),
};
