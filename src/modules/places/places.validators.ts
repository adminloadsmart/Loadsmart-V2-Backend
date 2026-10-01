import { z } from 'zod';

// Google's session tokens are arbitrary URL-safe strings; we ask clients for a UUID v4.
const sessionToken = z.string().uuid().optional();

export const placesValidators = {
  search: z.object({
    query: z.object({
      q: z.string().trim().min(2).max(200),
      sessionToken,
      // ISO 3166-1 alpha-2 — restricts suggestions to one country; this is an India-first product.
      country: z
        .string()
        .trim()
        .length(2)
        .transform((v) => v.toLowerCase())
        .default('in'),
    }),
  }),
  details: z.object({
    params: z.object({ placeId: z.string().trim().min(1).max(512) }),
    query: z.object({ sessionToken }),
  }),
};
