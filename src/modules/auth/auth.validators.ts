import { z } from 'zod';

const passwordSchema = z.string().min(6, 'Password must be at least 6 characters long');

const DESIGNATIONS = [
  'Owner',
  'Logistics Manager',
  'Factory Manager',
  'Dispatch Manager',
  'Accounts',
  'Administration manager',
  'Others',
] as const;

const DEPARTMENTS = [
  'Sales',
  'Logistics',
  'Dispatch',
  'Accounts',
  'Administration',
  'Management',
] as const;

const userDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, 'Name must be at least 3 characters long')
      .max(100, 'Name must not exceed 100 characters')
      .regex(/^[A-Za-z]+(?:[ ]+[A-Za-z]+)*$/, 'Name may contain only alphabets and spaces'),
    email: z.string().trim().email('Email ID must be a valid email address').optional(),
    password: passwordSchema.optional(),
    designation: z.enum(DESIGNATIONS).optional(),
    manualDesignation: z
      .string()
      .trim()
      .min(1, 'Manual designation is required')
      .max(100, 'Manual designation must not exceed 100 characters')
      .optional(),
    department: z.enum(DEPARTMENTS).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.designation === 'Others' && !data.manualDesignation) {
      ctx.addIssue({
        code: 'custom',
        path: ['manualDesignation'],
        message: 'Manual designation is required when designation is Others',
      });
    }
    if (data.designation !== 'Others' && data.manualDesignation) {
      ctx.addIssue({
        code: 'custom',
        path: ['manualDesignation'],
        message: 'Manual designation is only allowed when designation is Others',
      });
    }
  });

// Optional on every session-issuing endpoint below — a client sends these when it has an FCM
// token to register; deviceType is required alongside fcmToken (enforced per-schema via
// .superRefine, since it's the only field zod can't express as "required if a sibling is
// present" declaratively). No ipAddress field here — that's always derived server-side from
// req.ip, never client-supplied.
const deviceTokenFields = {
  fcmToken: z.string().trim().min(1).max(512).optional(),
  deviceType: z.enum(['ios', 'android', 'web']).optional(),
  deviceInfo: z.string().trim().max(255).optional(),
};

export const authValidators = {
  signup: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
    }),
  }),
  requestLoginOtp: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
      portal: z.enum(['organization', 'platform']),
    }),
  }),
  verifyOtp: z.object({
    body: z
      .object({
        otp: z.string().length(4, 'OTP must be 4 digits long'),
        ...deviceTokenFields,
      })
      .superRefine((data, ctx) => {
        if (data.fcmToken && !data.deviceType) {
          ctx.addIssue({
            code: 'custom',
            path: ['deviceType'],
            message: 'deviceType is required when fcmToken is provided',
          });
        }
      }),
  }),
  verifyLoginOtp: z.object({
    body: z
      .object({
        otp: z.string().length(4, 'OTP must be 4 digits long'),
        ...deviceTokenFields,
      })
      .superRefine((data, ctx) => {
        if (data.fcmToken && !data.deviceType) {
          ctx.addIssue({
            code: 'custom',
            path: ['deviceType'],
            message: 'deviceType is required when fcmToken is provided',
          });
        }
      }),
  }),
  login: z.object({
    body: z
      .object({
        phoneNumber: z.string().trim().min(10),
        password: z.string().min(1),
        portal: z.enum(['organization', 'platform']),
        ...deviceTokenFields,
      })
      .superRefine((data, ctx) => {
        if (data.fcmToken && !data.deviceType) {
          ctx.addIssue({
            code: 'custom',
            path: ['deviceType'],
            message: 'deviceType is required when fcmToken is provided',
          });
        }
      }),
  }),
  createPassword: z.object({
    body: z
      .object({
        password: passwordSchema,
        confirmPassword: z.string().min(1),
      })
      .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
          ctx.addIssue({
            code: 'custom',
            path: ['confirmPassword'],
            message: 'Passwords do not match',
          });
        }
      }),
  }),
  refresh: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
      portal: z.enum(['organization', 'platform']),
    }),
  }),
  // No `logout` validator — the route takes no body at all (see auth.routes.ts/auth.controller.ts).
  // Strict — this endpoint's only job is to set a new value, unlike the optional device fields
  // on login/verify-otp above.
  updateDeviceToken: z.object({
    body: z
      .object({
        fcmToken: z.string().trim().min(1).max(512),
        deviceType: z.enum(['ios', 'android', 'web']),
      })
      .strict(),
  }),
  saveUserDetails: z.object({ body: userDetailsSchema }),
};
