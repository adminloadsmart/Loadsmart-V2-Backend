import { z } from 'zod';
import { UPLOAD_PURPOSES } from './storage.constants';

const uuid = z.string().uuid();
const params = z.object({ fileId: uuid });

export const storageValidators = {
  generateUploadUrl: z.object({
    body: z
      .object({
        purpose: z.enum(UPLOAD_PURPOSES),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(255),
        sizeBytes: z.coerce.number().int().positive(),
      })
      .strict(),
  }),
  confirmUpload: z.object({ params }),
  get: z.object({ params }),
  getByKey: z.object({ query: z.object({ key: z.string().trim().min(1) }) }),
  remove: z.object({ params }),
};
