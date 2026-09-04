import { z } from 'zod';
import { isoDateSchema } from '../../shared/utils/date';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

export const transporterSettlementValidators = {
  summary: z.object({ params }),
  record: z.object({
    params,
    body: z
      .object({
        utrReference: z.string().trim().min(1).max(100),
        proofFileKey: z.string().trim().min(1).optional(),
        paymentDate: isoDateSchema,
      })
      .strict(),
  }),
};
