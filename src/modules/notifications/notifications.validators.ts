import { z } from 'zod';
import { paginationQuery } from '../../shared/validators/pagination';

const params = z.object({ notificationId: z.string().uuid() });

// Only the HTTP-facing routes need validators — creating a notification (send()) is called
// in-process only, never over HTTP, so there is no `create` schema here.
export const notificationValidators = {
  list: z.object({
    query: paginationQuery.extend({
      unreadOnly: z.coerce.boolean().optional(),
    }),
  }),
  get: z.object({ params }),
  markRead: z.object({ params }),
};
