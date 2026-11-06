import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';
import {
  BUY_METHODS,
  SHIPPER_ANALYTICS_PERIODS,
  SPEND_MEASURES,
} from './utils/shipper-analytics.constants';

const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(120);

/** The period every tab shares (§6). Custom needs both dates, in order. */
const periodQuery = z.object({
  period: z.enum(SHIPPER_ANALYTICS_PERIODS).default('6_months'),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

type PeriodQuery = z.infer<typeof periodQuery>;

function checkPeriod(data: PeriodQuery, ctx: z.RefinementCtx) {
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
}

/** The filter bar (§6). Choosing a Lane clears Plant and Destination, and the reverse — so the
 *  two are never sent together. */
const filterFields = periodQuery.extend({
  plantId: uuid.optional(),
  destinationCity: text.optional(),
  laneKey: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[^|]+\|[^|]+$/, 'laneKey is `${fromCity}|${toCity}` from /shipper/filters')
    .optional(),
  transporterId: z.string().min(1).max(64).optional(),
  customerId: uuid.optional(),
  commodityId: uuid.optional(),
  bodyType: z.string().min(1).max(40).optional(),
  size: z.string().min(1).max(40).optional(),
  boughtAs: z.enum(BUY_METHODS).optional(),
  businessUnit: text.optional(),
});

function checkFilters(data: z.infer<typeof filterFields>, ctx: z.RefinementCtx) {
  checkPeriod(data, ctx);
  if (data.laneKey && (data.plantId || data.destinationCity)) {
    ctx.addIssue({
      code: 'custom',
      path: ['laneKey'],
      message: 'laneKey cannot be combined with plantId or destinationCity',
    });
  }
}

const filterQuery = filterFields.superRefine(checkFilters);

const tabQuery = z.object({ query: filterQuery });

export const shipperAnalyticsValidators = {
  getFilters: z.object({ query: periodQuery.superRefine(checkPeriod) }),
  getOverview: tabQuery,
  getFreightSpend: z.object({
    // Extend before refining: an intersection (`.and`) can't be split into OpenAPI query params.
    query: filterFields
      .extend({ measure: z.enum(SPEND_MEASURES).default('spend') })
      .superRefine(checkFilters),
  }),
  getTransporters: tabQuery,
  getService: tabQuery,
  getBilling: tabQuery,
};
