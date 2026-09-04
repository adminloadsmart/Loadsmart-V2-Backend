import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { isoDateSchema } from '../../shared/utils/date';

const uuid = z.string().uuid();

const dateRangeRefine = <T extends { from?: string; to?: string }>(data: T) =>
  !data.from || !data.to || data.from <= data.to;
const dateRangeMessage = { message: '"from" must be on or before "to"', path: ['to'] };

export const transporterPayablesValidators = {
  dashboard: z.object({
    query: pagination
      .extend({
        transporterId: uuid.optional(),
        overdueOnly: z.coerce.boolean().optional(),
        podPending: z.coerce.boolean().optional(),
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
      })
      .refine(dateRangeRefine, dateRangeMessage),
  }),
  transporterLoads: z.object({
    params: z.object({ transporterId: uuid }),
    query: pagination.extend({
      overdueOnly: z.coerce.boolean().optional(),
      podPending: z.coerce.boolean().optional(),
    }),
  }),
};
