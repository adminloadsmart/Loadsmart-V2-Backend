import { z } from 'zod';

// Mirrors masters.validators.ts's `isoDate` — duplicated locally rather than shared across
// modules, following this codebase's existing per-module validator convention (see also
// admin.validators.ts's own copy).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const dashboardsValidators = {
  getFleetActivity: z.object({
    query: z
      .object({ from: isoDate.optional(), to: isoDate.optional() })
      .refine((data) => !data.from || !data.to || data.from <= data.to, {
        message: '"from" must be on or before "to"',
        path: ['to'],
      }),
  }),
};
