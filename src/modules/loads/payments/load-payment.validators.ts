import { z } from 'zod';
import { isoDateSchema } from '../../../shared/utils/date';
import { PAYMENT_HEADS, PAYMENT_MODES } from '../money/money-rules';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });
const reference = z.string().trim().min(1).max(100);
const amount = z.number().nonnegative().max(100_000_000);

/** The advance — "amount, UTR, account, NEFT or UPI, proof (optional)". */
const advanceBody = z
  .object({
    amount: amount.positive().optional(),
    utrReference: reference,
    paymentMode: z.enum(PAYMENT_MODES),
    account: z.string().trim().min(1).max(100),
    transactionId: reference.optional(),
    proofFileKey: z.string().trim().min(1).optional(),
    paymentDate: isoDateSchema,
  })
  .strict();

/** The balance — the amount under each head, and at least one proof (checked in the service). */
const balanceBody = z
  .object({
    utrReference: reference.optional(),
    transactionId: reference.optional(),
    proofFileKey: z.string().trim().min(1).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    account: z.string().trim().min(1).max(100).optional(),
    heads: z.partialRecord(z.enum(PAYMENT_HEADS), amount).optional(),
    paymentDate: isoDateSchema,
  })
  .strict();

export const loadPaymentValidators = {
  recordAdvance: z.object({ params, body: advanceBody }),
  recordBalance: z.object({ params, body: balanceBody }),
  list: z.object({ params }),
  summary: z.object({ params }),
};
