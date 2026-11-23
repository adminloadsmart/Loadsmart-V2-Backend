import { z } from 'zod';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { DEMO_REQUEST_PRODUCTS } from './demo-requests.types';

/** Accepts "9876543210", "98765 43210" or "+91 98765 43210"; yields the bare 10 digits. */
const indianMobile = z
  .string()
  .transform((v) => {
    const digits = normalizePhoneNumber(v);
    return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  })
  .refine((v) => /^[6-9]\d{9}$/.test(v), { message: 'validation.indianMobile' });

export const demoRequestsValidators = {
  create: z.object({
    body: z
      .object({
        name: z.string().trim().min(2).max(120),
        companyName: z.string().trim().min(2).max(160),
        email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
        phoneNumber: indianMobile,
        product: z.enum(DEMO_REQUEST_PRODUCTS),
        website: z.string().max(200).optional(),
      })
      .strict(),
  }),
};
