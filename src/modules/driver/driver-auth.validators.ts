import { z } from 'zod';

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

export const driverAuthValidators = {
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
};
