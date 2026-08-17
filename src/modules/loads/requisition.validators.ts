import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { isoDateSchema } from '../../shared/utils/date';
import { REQUISITION_STATUSES } from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ requisitionId: uuid });

export const requisitionValidators = {
  create: z.object({
    body: z
      .object({
        customerId: uuid,
        productId: uuid,
        quantityTonnes: z.number().positive(),
        loadingPointId: uuid,
        customerDeliveryPointId: uuid,
        expectedDeliveryDate: isoDateSchema,
        customerPoNumber: z.string().trim().min(1).max(100),
      })
      .strict(),
  }),
  list: z.object({
    query: pagination.extend({
      search: z.string().min(1).optional(),
      status: z.enum(REQUISITION_STATUSES).optional(),
      customerId: uuid.optional(),
    }),
  }),
  get: z.object({ params }),
  close: z.object({
    params,
    body: z.object({ reason: z.string().trim().min(1) }).strict(),
  }),
};
