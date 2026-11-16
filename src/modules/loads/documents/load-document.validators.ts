import { z } from 'zod';
import { booleanString } from '../../../shared/validators/boolean-string';
import { DOCUMENT_REVIEW_DECISIONS } from './load-document.types';

const params = z.object({ loadId: z.string().uuid() });

export const reviewDocumentBody = z
  .object({
    decision: z.enum(DOCUMENT_REVIEW_DECISIONS),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.decision === 'rejected' && !data.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required to reject' });
    }
  });

export const loadDocumentValidators = {
  list: z.object({
    params,
    query: z.object({ history: booleanString.optional() }),
  }),
  review: z.object({
    params: params.extend({ documentId: z.string().uuid() }),
    body: reviewDocumentBody,
  }),
};
