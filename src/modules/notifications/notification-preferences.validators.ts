import { z } from 'zod';

const channelsBody = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
  whatsapp: z.boolean(),
});

// GET and the reset action take no params/query/body — only the bulk-save PUT needs validation.
export const notificationPreferencesValidators = {
  update: z.object({
    body: z.object({
      items: z.array(z.object({ key: z.string().min(1), channels: channelsBody })).min(1),
    }),
  }),
};
