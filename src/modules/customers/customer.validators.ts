import { z } from 'zod';
import { paginationQuery } from '../../shared/validators/pagination';
import { CUSTOMER_STATUSES } from './utils/customer.status';

const uuid = z.string().uuid();
const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/^\+/, '').replace(/[\s-]/g, ''))
  .refine((v) => /^\d{10,15}$/.test(v), 'Expected a 10-15 digit mobile number');
const pinCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Expected a 6-digit PIN code');
/** Address Component — reused for each delivery point and for the billing address. */
const addressComponent = {
  addressLine1: z.string().trim().min(1).max(255).optional(),
  addressLine2: z.string().trim().min(1).max(255).optional(),
  landmark: z.string().trim().min(1).max(255).optional(),
  areaLocality: z.string().trim().min(1).max(255).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  pinCode: pinCode.optional(),
};
const point = z.object({ location: z.string().trim().min(1).max(255), ...addressComponent });
const fields = {
  name: z.string().trim().min(1).max(150),
  mobile,
  email: z.string().trim().email().max(255).optional(),
  gstin: z.string().trim().min(1).max(15).optional(),
  deliveryPoints: z.array(point).max(100).optional(),
  advancePercentage: z.number().min(0).max(100).optional(),
  balancePercentage: z.number().min(0).max(100).optional(),
  creditDays: z.number().int().nonnegative().max(36500).optional(),
  rateContract: z.string().trim().max(255).optional(),
  billingAddressLine1: addressComponent.addressLine1,
  billingAddressLine2: addressComponent.addressLine2,
  billingLandmark: addressComponent.landmark,
  billingAreaLocality: addressComponent.areaLocality,
  billingCity: addressComponent.city,
  billingState: addressComponent.state,
  billingPinCode: addressComponent.pinCode,
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
        balancePercentage: fields.balancePercentage.nullable(),
        creditDays: fields.creditDays.nullable(),
        rateContract: fields.rateContract.nullable(),
        billingAddressLine1: fields.billingAddressLine1.nullable(),
        billingAddressLine2: fields.billingAddressLine2.nullable(),
        billingLandmark: fields.billingLandmark.nullable(),
        billingAreaLocality: fields.billingAreaLocality.nullable(),
        billingCity: fields.billingCity.nullable(),
        billingState: fields.billingState.nullable(),
        billingPinCode: fields.billingPinCode.nullable(),
      })
      .partial()
      .strict(),
  }),
  approve: z.object({ params }),
  reject: z.object({ params, body: z.object({ reason: z.string().trim().min(1) }) }),
  delete: z.object({ params: deleteParams }),
};
