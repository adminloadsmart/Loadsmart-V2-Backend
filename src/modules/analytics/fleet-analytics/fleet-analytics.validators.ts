import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';
import {
  FLEET_ANALYTICS_HELD_AS,
  FLEET_ANALYTICS_PERIODS,
} from './utils/fleet-analytics.constants';

const uuid = z.string().uuid();

/**
 * The filter bar every Fleet Analytics tab shares. `yardId` and `customerId` are accepted so the
 * frontend can send the whole bar unchanged, but neither filters anything yet: there is no yard
 * model, and customer only narrows load metrics, which are all 0 until loads are wired in.
 */
const fleetAnalyticsQuery = z
  .object({
    period: z.enum(FLEET_ANALYTICS_PERIODS).default('6_months'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    truckTypeId: uuid.optional(),
    heldAs: z.enum(FLEET_ANALYTICS_HELD_AS).default('owned_and_attached'),
    yardId: uuid.optional(),
    customerId: uuid.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.period !== 'custom') return;
    if (!data.from || !data.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from and to are required when period is custom',
      });
    } else if (data.from > data.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: '`from` must be on or before `to`' });
    }
  });

const tabQuery = z.object({ query: fleetAnalyticsQuery });

export const fleetAnalyticsValidators = {
  getFilters: z.object({ query: z.object({}) }),
  getSummary: tabQuery,
  getOverview: tabQuery,
  getUtilisation: tabQuery,
  getCost: tabQuery,
  getEnergy: tabQuery,
  getMaintenance: tabQuery,
  getOperations: tabQuery,
  getCompliance: tabQuery,
};
