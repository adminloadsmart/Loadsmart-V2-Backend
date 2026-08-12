import { z } from 'zod';
import { paginationQuery } from '../../shared/validators/pagination';
import { CUSTOMER_STATUSES } from './utils/customer.status';

const uuid = z.string().uuid();
const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^\d{10,15}$/.test(v), 'Expected a 10-15 digit mobile number');
const point = z.object({ location: z.string().trim().min(1).max(255) });
const fields = {
  name: z.string().trim().min(1).max(150),
  mobile,
  email: z.string().trim().email().max(255).optional(),
  gstin: z.string().trim().min(1).max(15).optional(),
  deliveryPoints: z.array(point).max(100).optional(),
  advancePercentage: z.number().min(0).max(100).optional(),
  creditDays: z.number().int().nonnegative().max(36500).optional(),
  rateContract: z.string().trim().max(255).optional(),
};
const params = z.object({ customerId: uuid });
const deleteParams = z.object({ customer_id: uuid });
export const customerValidators = {
  create: z.object({ body: z.object(fields).strict() }),
  list: z.object({
    query: paginationQuery.extend({ status: z.enum(CUSTOMER_STATUSES).optional() }),
  }),
  get: z.object({ params }),
  update: z.object({
    params,
    body: z
      .object({
        ...fields,
        email: fields.email.nullable(),
        gstin: fields.gstin.nullable(),
        advancePercentage: fields.advancePercentage.nullable(),
        creditDays: fields.creditDays.nullable(),
        rateContract: fields.rateContract.nullable(),
      })
      .partial()
      .strict(),
  }),
  approve: z.object({ params }),
  delete: z.object({ params: deleteParams }),
};
