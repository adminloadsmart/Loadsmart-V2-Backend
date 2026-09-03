import { z } from 'zod';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { IFSC_REGEX } from '../masters.constants';
import { TRANSPORTER_COMPANY_TYPES, TRANSPORTER_STATUSES } from './transporter.types';

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
/** PRD §5.4.2 (FMS-MAS-TRN-001) — only name and phone are mandatory, everything else optional. */
const transporterFields = {
  name: z.string().trim().min(1).max(150),
  phone: transporterPhone,
  rate: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255).optional(),
  gstin: z.string().trim().min(1).max(15).optional(),
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
};

export const transporterValidators = {
  createTransporter: z.object({ body: z.object(transporterFields).strict() }),
  listTransporters: z.object({ query: pagination }),
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
      })
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
  }),
  deleteTransporter: z.object({ params: transporterParams }),
};
