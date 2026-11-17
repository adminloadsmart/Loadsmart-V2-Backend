import { z } from 'zod';
import { TRANSPORTER_CHARGE_HEADS } from './charge.types';

export const loadChargeValidators = {
  // A charge with its proof on an own-transporter or indent load.
  add: z.object({
    params: z.object({ loadId: z.string().uuid() }),
    body: z
      .object({
        head: z.enum(TRANSPORTER_CHARGE_HEADS),
        amount: z.number().positive().max(100_000_000),
        remark: z.string().trim().min(1).max(500).optional(),
        proofFileKey: z.string().trim().min(1),
      })
      .strict(),
  }),
};
