import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';

export const driverAnalyticsValidators = {
  // Neither `from` nor `to` is required — omit both for all-time trip stats/trend.
  getOverview: z.object({
    params: z.object({ driverId: z.string().uuid() }),
    query: z
      .object({ from: isoDate.optional(), to: isoDate.optional() })
      .refine(
        (data) => !data.from || !data.to || data.from <= data.to,
        '`from` must be on or before `to`',
      ),
  }),
};
