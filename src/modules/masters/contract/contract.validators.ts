import { z } from 'zod';
import { paginationQuery } from '../../../shared/validators/pagination';
import { isoDateSchema } from '../../../shared/utils/date';
import {
  CONTRACT_BILLING_UNITS,
  CONTRACT_DISPLAY_STATUSES,
  CONTRACT_MAX_PRIORITY,
  CONTRACT_SORT_FIELDS,
} from './contract.types';

const uuid = z.string().uuid();
const place = z.string().trim().min(1).max(100);
const params = z.object({ contractId: uuid });

const lane = {
  sourceCity: place,
  sourceState: place,
  destinationCity: place,
  destinationState: place,
};

const fields = {
  transporterId: uuid,
  ...lane,
  agreedRate: z.number().positive().max(100_000_000),
  billingUnit: z.enum(CONTRACT_BILLING_UNITS),
  validFrom: isoDateSchema,
  validTo: isoDateSchema,
  priority: z.number().int().min(1).max(CONTRACT_MAX_PRIORITY),
  sharePercentage: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

const validityOrder = (value: { validFrom?: string; validTo?: string }) =>
  !value.validFrom || !value.validTo || value.validTo >= value.validFrom;
const VALIDITY_MESSAGE = 'Expiry date must not be before the valid-from date';

const listFilters = {
  search: z.string().trim().min(1).optional(),
  status: z.enum(CONTRACT_DISPLAY_STATUSES).optional(),
  transporterId: uuid.optional(),
  sortBy: z.enum(CONTRACT_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
};

/** One bulk-upload row — the transporter is named by the template's dropdown value
 *  ("TRP-0001 · ABC Logistics"), or by code, GSTIN or exact name. */
export const contractImportRowSchema = z
  .object({
    transporter: z.string().trim().min(1).optional(),
    transporterCode: z.string().trim().min(1).optional(),
    transporterGstin: z.string().trim().min(1).optional(),
    transporterName: z.string().trim().min(1).optional(),
    ...lane,
    agreedRate: fields.agreedRate,
    billingUnit: fields.billingUnit,
    validFrom: isoDateSchema,
    validTo: isoDateSchema,
    priority: fields.priority,
    sharePercentage: fields.sharePercentage,
    notes: fields.notes,
  })
  .strict()
  .refine(validityOrder, VALIDITY_MESSAGE)
  .refine(
    (row) => row.transporter || row.transporterCode || row.transporterGstin || row.transporterName,
    { message: 'Transporter is required', path: ['transporter'] },
  );

export const contractValidators = {
  create: z.object({ body: z.object(fields).strict().refine(validityOrder, VALIDITY_MESSAGE) }),
  update: z.object({
    params,
    body: z
      .object(fields)
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
      .refine(validityOrder, VALIDITY_MESSAGE),
  }),
  list: z.object({ query: paginationQuery.extend(listFilters) }),
  export: z.object({ query: z.object(listFilters) }),
  get: z.object({ params }),
  delete: z.object({ params }),
  laneAllocation: z.object({
    query: z.object({ ...lane, excludeContractId: uuid.optional() }),
  }),
};
