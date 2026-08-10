import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../shared/utils/date';

export const dashboardsValidators = {
  getFleetActivity: z.object({
    query: z
      .object({ from: isoDate.optional(), to: isoDate.optional() })
      .refine((data) => !data.from || !data.to || data.from <= data.to, {
        message: '"from" must be on or before "to"',
        path: ['to'],
      }),
  }),
};
