import { z } from 'zod';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { IFSC_REGEX } from '../masters.constants';
import {
  TRANSPORTER_COMPANY_TYPES,
  TRANSPORTER_GST_TREATMENTS,
  TRANSPORTER_STATUSES,
} from './transporter.types';
import { TRANSPORTER_SORT_FIELDS } from './transporter.interface';
import { gstinSchema } from '../gst/gst.validators';
import { PICKER_BODIES } from '../vehicle/truck-type-picker.constants';

const uuid = z.string().uuid();
const transporterParams = z.object({ transporterId: uuid });
const transporterPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number');
const transporterBankIfsc = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code');
const contact = z
  .object({
    id: uuid.optional(),
    fullName: z.string().trim().min(1).max(150).nullable().optional(),
    designation: z.string().trim().min(1).max(100).nullable().optional(),
    phone: transporterPhone,
    isWhatsapp: z.boolean().optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
  })
  .strict();
const lane = z
  .object({
    id: uuid.optional(),
    originCity: z.string().trim().min(1).max(100),
    originState: z.string().trim().min(1).max(100).nullable().optional(),
    destinationCity: z.string().trim().min(1).max(100),
    destinationState: z.string().trim().min(1).max(100).nullable().optional(),
    distanceKm: z.number().int().positive().max(10000).nullable().optional(),
  })
  .strict();
const truckType = z
  .object({
    bodyType: z.enum(PICKER_BODIES).nullable().optional(),
    wheelCount: z.number().int().min(4).max(22).nullable().optional(),
    capacityTons: z.number().positive().max(100).nullable().optional(),
    lengthFt: z.number().positive().max(80).nullable().optional(),
  })
  .strict();
const upiVpa = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/, 'Invalid UPI ID');

/** PRD §5.4.2 (FMS-MAS-TRN-001) — only name and phone are mandatory, everything else optional. */
const transporterFields = {
  name: z.string().trim().min(1).max(150),
  phone: transporterPhone,
  rate: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255).optional(),
  gstin: gstinSchema.optional(),
  gstVerificationId: uuid.optional(),
  msmeRegistration: z.string().trim().min(1).max(50).optional(),
  companyType: z.enum(TRANSPORTER_COMPANY_TYPES).optional(),
  status: z.enum(TRANSPORTER_STATUSES).optional(),
  advancePercentage: z.number().min(0).max(100).optional(),
  creditDays: z.number().int().nonnegative().max(36500).optional(),
  addressLine1: z.string().trim().min(1).max(255).optional(),
  addressLine2: z.string().trim().min(1).max(255).optional(),
  landmark: z.string().trim().min(1).max(255).optional(),
  areaLocality: z.string().trim().min(1).max(255).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  pinCode: z
    .string()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
    .optional(),
  bankAccountNumber: z.string().trim().min(6).max(30).optional(),
  bankIfsc: transporterBankIfsc.optional(),
  bankAccountHolderName: z.string().trim().min(1).max(150).optional(),
  bankNameBranch: z.string().trim().min(1).max(150).optional(),
  upiVpa: upiVpa.optional(),
  gstTreatment: z.enum(TRANSPORTER_GST_TREATMENTS).optional(),
  trucksDeclared: z.number().int().nonnegative().max(100000).optional(),
  truckType: truckType.optional(),
  contacts: z.array(contact).max(20).optional(),
  lanes: z.array(lane).max(100).optional(),
};
const transporterListQuery = pagination.extend({
  status: z.enum(TRANSPORTER_STATUSES).optional(),
  sortBy: z.enum(TRANSPORTER_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const transporterValidators = {
  createTransporter: z.object({ body: z.object(transporterFields).strict() }),
  listTransporters: z.object({ query: transporterListQuery }),
  exportTransporters: z.object({
    query: transporterListQuery.omit({ page: true, limit: true }),
  }),
  transporterLoads: z.object({
    params: transporterParams,
    query: pagination.omit({ search: true }),
  }),
  updateStatus: z.object({
    params: transporterParams,
    body: z.object({ status: z.enum(TRANSPORTER_STATUSES) }).strict(),
  }),
  getTransporter: z.object({ params: transporterParams }),
  updateTransporter: z.object({
    params: transporterParams,
    body: z
      .object({
        ...transporterFields,
        rate: transporterFields.rate.nullable(),
        email: transporterFields.email.nullable(),
        gstin: transporterFields.gstin.nullable(),
        msmeRegistration: transporterFields.msmeRegistration.nullable(),
        companyType: transporterFields.companyType.nullable(),
        advancePercentage: transporterFields.advancePercentage.nullable(),
        creditDays: transporterFields.creditDays.nullable(),
        addressLine1: transporterFields.addressLine1.nullable(),
        addressLine2: transporterFields.addressLine2.nullable(),
        landmark: transporterFields.landmark.nullable(),
        areaLocality: transporterFields.areaLocality.nullable(),
        city: transporterFields.city.nullable(),
        state: transporterFields.state.nullable(),
        pinCode: transporterFields.pinCode.nullable(),
        bankAccountNumber: transporterFields.bankAccountNumber.nullable(),
        bankIfsc: transporterFields.bankIfsc.nullable(),
        bankAccountHolderName: transporterFields.bankAccountHolderName.nullable(),
        gstVerificationId: transporterFields.gstVerificationId.nullable(),
        bankNameBranch: transporterFields.bankNameBranch.nullable(),
        upiVpa: transporterFields.upiVpa.nullable(),
        gstTreatment: transporterFields.gstTreatment.nullable(),
        trucksDeclared: transporterFields.trucksDeclared.nullable(),
        truckType: transporterFields.truckType.nullable(),
      })
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
  }),
  deleteTransporter: z.object({ params: transporterParams }),
};
