import { z } from 'zod';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination';

// Common list-query shape (page/limit/search) shared across every module's *.validators.ts —
// each module extends this with its own filters via paginationQuery.extend({...}).
export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().min(1).optional(),
});
