import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .refine((value) => /[a-z]/.test(value), 'Password must include at least one lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must include at least one uppercase letter')
  .refine((value) => /[0-9]/.test(value), 'Password must include at least one number')
  .refine(
    (value) => /[^A-Za-z0-9]/.test(value),
    'Password must include at least one special character',
  );

export const authValidators = {
  signup: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
    }),
  }),
  requestLoginOtp: z.object({
    body: z.object({
      phoneNumber: z.string().trim().min(10),
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
    }),
  }),
  logout: z.object({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
};
