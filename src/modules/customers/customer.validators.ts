import { z } from 'zod';
import { paginationQuery } from '../../shared/validators/pagination';
import { CUSTOMER_INVOICE_AGAINST, CUSTOMER_STATUSES } from './utils/customer.status';
import { gstinSchema } from '../masters/gst/gst.validators';
import { GST_RECORD_STATUSES } from '../masters/gst/gst.types';

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
const email = z.string().trim().email().max(255);
const money = z.number().nonnegative().max(1_000_000_000_000);

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

/** One unloading point. `id` (update only) edits that row in place instead of replacing it. */
const point = z
  .object({
    id: uuid.optional(),
    location: z.string().trim().min(1).max(255),
    addressLine1: addressComponent.addressLine1.nullable(),
    addressLine2: addressComponent.addressLine2.nullable(),
    landmark: addressComponent.landmark.nullable(),
    areaLocality: addressComponent.areaLocality.nullable(),
    city: addressComponent.city.nullable(),
    state: addressComponent.state.nullable(),
    pinCode: addressComponent.pinCode.nullable(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    googlePlaceId: z.string().trim().min(1).max(255).nullable().optional(),
    geofenceRadiusM: z.number().int().min(50).max(5000).nullable().optional(),
    pocName: z.string().trim().min(1).max(150).nullable().optional(),
    pocPhone: mobile.nullable().optional(),
    pocEmail: email.nullable().optional(),
  })
  .strict();

/** One point of contact — the design requires phone and email on every contact card. */
const contact = z
  .object({
    id: uuid.optional(),
    fullName: z.string().trim().min(1).max(150).nullable().optional(),
    designation: z.string().trim().min(1).max(100).nullable().optional(),
    phone: mobile,
    isWhatsapp: z.boolean().optional(),
    email,
  })
  .strict();

const fields = {
  name: z.string().trim().min(1).max(150),
  gstin: gstinSchema,
  gstVerificationId: uuid.optional(),
  registeredAddress: z.string().trim().min(1).max(1000),
  contacts: z.array(contact).min(1).max(20),
  deliveryPoints: z.array(point).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  invoiceAgainst: z.enum(CUSTOMER_INVOICE_AGAINST).optional(),
  freeHoursAtDrop: z.number().int().min(0).max(240).optional(),
  balanceAmount: money.optional(),
  creditLimit: money.optional(),
  creditDays: z.number().int().nonnegative().max(36500).optional(),
};

/** Fields from the pre-redesign form — still accepted so the bulk import and older clients keep
 *  working; the redesigned Settings screens don't send them. */
const legacyFields = {
  mobile: mobile.optional(),
  email: email.optional(),
  contactPersonName: z.string().trim().min(1).max(150).optional(),
  contactPersonNumber: mobile.optional(),
  contactPersonEmail: email.optional(),
  contactPersonDesignation: z.string().trim().min(1).max(100).optional(),
  contactPersonDesignationOther: z.string().trim().min(1).max(100).optional(),
  advancePercentage: z.number().min(0).max(100).optional(),
  balancePercentage: z.number().min(0).max(100).optional(),
  rateContract: z.string().trim().max(255).optional(),
  billingAddressLine1: addressComponent.addressLine1,
  billingAddressLine2: addressComponent.addressLine2,
  billingLandmark: addressComponent.landmark,
  billingAreaLocality: addressComponent.areaLocality,
  billingCity: addressComponent.city,
  billingState: addressComponent.state,
  billingPinCode: addressComponent.pinCode,
};

const nullableAll = <T extends Record<string, z.ZodTypeAny>>(shape: T) =>
  Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.nullable()])) as {
    [K in keyof T]: z.ZodNullable<T[K]>;
  };

const params = z.object({ customerId: uuid });
const deleteParams = z.object({ customer_id: uuid });
const listQuery = paginationQuery.extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  gstVerificationStatus: z.enum(GST_RECORD_STATUSES).optional(),
});

export const customerValidators = {
  create: z.object({ body: z.object({ ...fields, ...legacyFields }).strict() }),
  /** One bulk-upload row: same fields, but GSTIN, address and contacts may be missing (older
   *  sheets only carry name + mobile) — the row needs a mobile or a GSTIN to be identifiable. */
  importRow: z.object({
    body: z
      .object({
        ...legacyFields,
        ...fields,
        gstin: z
          .string()
          .trim()
          .transform((value) => value.toUpperCase())
          .pipe(z.string().min(1).max(15))
          .optional(),
        registeredAddress: fields.registeredAddress.optional(),
        contacts: z.array(contact).max(20).optional(),
      })
      .strict()
      .refine((row) => row.mobile || row.gstin, 'A mobile number or GSTIN is required'),
  }),
  list: z.object({ query: listQuery }),
  export: z.object({ query: listQuery.omit({ page: true, limit: true }) }),
  get: z.object({ params }),
  loads: z.object({ params, query: paginationQuery.omit({ search: true }) }),
  update: z.object({
    params,
    body: z
      .object({
        ...fields,
        ...nullableAll({
          gstin: fields.gstin,
          gstVerificationId: uuid,
          registeredAddress: fields.registeredAddress,
          notes: z.string().trim().max(2000),
          invoiceAgainst: z.enum(CUSTOMER_INVOICE_AGAINST),
          freeHoursAtDrop: z.number().int().min(0).max(240),
          balanceAmount: money,
          creditLimit: money,
          creditDays: z.number().int().nonnegative().max(36500),
        }),
        ...legacyFields,
        ...nullableAll({
          email,
          contactPersonName: z.string().trim().min(1).max(150),
          contactPersonNumber: mobile,
          contactPersonEmail: email,
          contactPersonDesignation: z.string().trim().min(1).max(100),
          contactPersonDesignationOther: z.string().trim().min(1).max(100),
          advancePercentage: z.number().min(0).max(100),
          balancePercentage: z.number().min(0).max(100),
          rateContract: z.string().trim().max(255),
          billingAddressLine1: z.string().trim().min(1).max(255),
          billingAddressLine2: z.string().trim().min(1).max(255),
          billingLandmark: z.string().trim().min(1).max(255),
          billingAreaLocality: z.string().trim().min(1).max(255),
          billingCity: z.string().trim().min(1).max(100),
          billingState: z.string().trim().min(1).max(100),
          billingPinCode: pinCode,
        }),
        mobile,
        contacts: fields.contacts,
      })
      .partial()
      .strict(),
  }),
  approve: z.object({ params }),
  reject: z.object({ params, body: z.object({ reason: z.string().trim().min(1) }) }),
  updateStatus: z.object({ params, body: z.object({ status: z.enum(['active', 'inactive']) }) }),
  delete: z.object({ params: deleteParams }),
};
