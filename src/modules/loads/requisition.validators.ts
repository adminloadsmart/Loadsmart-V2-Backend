import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { isoDateSchema } from '../../shared/utils/date';
import { REQUISITION_ITEM_UNITS, REQUISITION_STATUSES } from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ requisitionId: uuid });

// Tonnage is mandatory and wins if typed directly; otherwise quantity+unit are both required and
// requisition.service.ts derives tonnage from the product's weight per pack (§4.1).
const productLine = z
  .object({
    productId: uuid,
    quantityTonnes: z.number().positive().optional(), // V-02/V-03
    quantity: z.number().positive().optional(),
    unit: z.enum(REQUISITION_ITEM_UNITS).optional(),
  })
  .strict()
  .refine(
    (line) =>
      line.quantityTonnes !== undefined || (line.quantity !== undefined && line.unit !== undefined),
    'Provide either quantityTonnes, or both quantity and unit',
  );

const override = z
  .object({
    checkId: z.literal('C05'),
    reason: z.string().trim().min(15), // V-17
  })
  .strict();

export const requisitionValidators = {
  create: z.object({
    body: z
      .object({
        customerId: uuid,
        products: z.array(productLine).min(1), // R-02
        loadingPointId: uuid,
        customerDeliveryPointId: uuid,
        expectedDeliveryDate: isoDateSchema,
        customerPoNumber: z.string().trim().min(1).max(100),
        overrides: z.array(override).max(1).optional(),
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
  // Hard delete — only allowed while the requisition has zero loads against it (undoes a
  // mistaken create). Once any load exists, `close` is the only removal-adjacent action.
  delete: z.object({ params }),
};
