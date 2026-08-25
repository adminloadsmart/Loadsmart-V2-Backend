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
    body: z.object({
      otp: z.string().length(4, 'OTP must be 4 digits long'),
    }),
  }),
  verifyLoginOtp: z.object({
    body: z.object({
      otp: z.string().length(4, 'OTP must be 4 digits long'),
    }),
  }),
  login: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
      password: z.string().min(1),
      portal: z.enum(['organization', 'platform']),
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
  logout: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
  saveUserDetails: z.object({ body: userDetailsSchema }),
};
