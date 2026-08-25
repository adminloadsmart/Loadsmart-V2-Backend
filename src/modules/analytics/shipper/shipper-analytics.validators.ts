import { z } from 'zod';
import { isoDateSchema } from '../../../shared/utils/date';

export const shipperAnalyticsValidators = {
  getOverview: z.object({
    query: z
      .object({
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
      })
      .refine((data) => !data.from || !data.to || data.from <= data.to, {
        message: '"from" must be on or before "to"',
        path: ['to'],
      }),
  }),
};
