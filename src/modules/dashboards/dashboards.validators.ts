import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../shared/utils/date';
import { DATE_FILTERS } from '../../shared/utils/date-filter';

export const dashboardsValidators = {
  getFleetActivity: z.object({
    query: z
      .object({ from: isoDate.optional(), to: isoDate.optional() })
      .refine((data) => !data.from || !data.to || data.from <= data.to, {
        message: '"from" must be on or before "to"',
        path: ['to'],
      }),
  }),

  getLoadsSummary: z.object({
    query: z
      .object({
        filter: z.enum(DATE_FILTERS).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .superRefine((data, ctx) => {
        if (data.filter === 'custom' && (!data.from || !data.to)) {
          ctx.addIssue({
            code: 'custom',
            path: ['from'],
            message: 'from and to are required when filter is custom',
          });
        }
        if (data.from && data.to && data.from > data.to) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: 'to must be on/after from',
          });
        }
      }),
  }),
};
