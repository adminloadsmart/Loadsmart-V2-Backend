import { z } from 'zod';
import { settingsInputSchema } from './settings.types';

export const settingsValidators = {
  save: z.object({
    body: z
      .object({
        settings: settingsInputSchema,
        note: z.string().trim().max(500).optional(),
        basedOnVersion: z.number().int().min(0).optional(),
      })
      .strict(),
  }),
  versions: z.object({
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
  }),
  version: z.object({ params: z.object({ versionId: z.string().uuid() }) }),
};
