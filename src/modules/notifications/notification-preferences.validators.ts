import { z } from 'zod';

const channelsBody = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
  whatsapp: z.boolean(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

// GET and the reset action take no params/query/body — only the PUTs need validation.
export const notificationPreferencesValidators = {
  updateQuietHours: z.object({
    body: z.object({ enabled: z.boolean(), startTime: hhmm, endTime: hhmm }),
  }),
  // The organisation's setting (org_admin) — external channels only; in-app isn't org-level.
  update: z.object({
    body: z.object({
      items: z.array(z.object({ key: z.string().min(1), channels: channelsBody })).min(1),
    }),
  }),
  // The caller's own preferences — also in-app; omitted inApp keeps its current value.
  updateMine: z.object({
    body: z.object({
      items: z
        .array(
          z.object({
            key: z.string().min(1),
            channels: channelsBody.extend({ inApp: z.boolean().optional() }),
          }),
        )
        .min(1),
    }),
  }),
};
