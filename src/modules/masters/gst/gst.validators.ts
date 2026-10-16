import { z } from 'zod';
import { GSTIN_REGEX } from '../../../shared/constants/gst-state-codes';

/** Trimmed, upper-cased, 15-char GSTIN — shared by verify, customers and transporters. */
export const gstinSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => GSTIN_REGEX.test(value), 'Invalid GSTIN');

export const gstValidators = {
  verify: z.object({
    body: z
      .object({
        gstin: gstinSchema,
        legalName: z.string().trim().min(1).max(255).optional(),
      })
      .strict(),
  }),
};
