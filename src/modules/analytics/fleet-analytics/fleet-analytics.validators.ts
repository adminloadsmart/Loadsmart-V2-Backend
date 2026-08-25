import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';

export const fleetAnalyticsValidators = {
  // Neither bound is required — omit both for all-time sourceMix counts. emiSummary ignores
  // this range entirely (see FleetAnalyticsRepository.getEmiSummary).
  getOverview: z.object({
    query: z
      .object({ from: isoDate.optional(), to: isoDate.optional() })
      .refine(
        (data) => !data.from || !data.to || data.from <= data.to,
        '`from` must be on or before `to`',
      ),
  }),
};
