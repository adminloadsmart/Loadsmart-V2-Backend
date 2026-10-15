import { z } from 'zod';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { isoDateSchema } from '../../../shared/utils/date';
import { INDIAN_STATES, resolveIndianState } from '../../../shared/constants/indian-states';
import { CONTRACT_STATUS_FILTERS, CONTRACT_UNITS } from './transporter-contract.types';

const uuid = z.string().uuid();
const contractParams = z.object({ contractId: uuid });
const customerParams = z.object({ customerId: uuid });

const city = z.string().trim().min(1).max(100);
/** A state or UT — canonical name or a common short form ("UP"), stored canonical. */
const state = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const resolved = resolveIndianState(value);
    if (!resolved) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected one of the Indian states/UTs (${INDIAN_STATES.length} allowed)`,
      });
      return z.NEVER;
    }
    return resolved;
  });

const contractFields = {
  customerId: uuid,
  transporterId: uuid,
  pickupCity: city,
  pickupState: state,
  dropCity: city,
  dropState: state,
  rate: z.number().positive().max(9_999_999_999),
  unit: z.enum(CONTRACT_UNITS),
  validFrom: isoDateSchema.optional(),
  validTo: isoDateSchema,
  priority: z.number().int().min(1).max(99),
  sharePercent: z.number().min(0.01).max(100).optional(),
};

const datesInOrder = (value: { validFrom?: string; validTo?: string }) =>
  !value.validFrom || !value.validTo || value.validTo >= value.validFrom;
const DATE_ORDER_MESSAGE = 'Contract expiry date must not be before its start date';

export const transporterContractValidators = {
  createContract: z.object({
    body: z.object(contractFields).strict().refine(datesInOrder, DATE_ORDER_MESSAGE),
  }),
  listContracts: z.object({
    query: pagination.extend({
      customerId: uuid.optional(),
      transporterId: uuid.optional(),
      pickupCity: z.string().trim().min(1).optional(),
      dropCity: z.string().trim().min(1).optional(),
      status: z.enum(CONTRACT_STATUS_FILTERS).optional(),
    }),
  }),
  getContract: z.object({ params: contractParams }),
  updateContract: z.object({
    params: contractParams,
    body: z
      .object(contractFields)
      .omit({ customerId: true })
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
      .refine(datesInOrder, DATE_ORDER_MESSAGE),
  }),
  deleteContract: z.object({ params: contractParams }),
  customerContracts: z.object({ params: customerParams }),
  laneSummary: z.object({
    query: z.object({
      customerId: uuid,
      pickupCity: city,
      pickupState: state,
      dropCity: city,
      dropState: state,
    }),
  }),
};
