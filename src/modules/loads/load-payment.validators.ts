import { z } from 'zod';
import { isoDateSchema } from '../../shared/utils/date';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

const paymentBody = z
  .object({
    utrReference: z.string().trim().min(1).max(100),
    proofFileKey: z.string().trim().min(1).optional(),
    paymentDate: isoDateSchema,
  })
  .strict();

export const loadPaymentValidators = {
  recordAdvance: z.object({ params, body: paymentBody }),
  recordBalance: z.object({ params, body: paymentBody }),
  list: z.object({ params }),
};
