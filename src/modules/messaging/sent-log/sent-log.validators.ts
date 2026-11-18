import { z } from 'zod';

const params = z.object({ loadId: z.string().uuid() });

/** The load's message log (tasks 3 and 4). */
export const sentLogValidators = {
  loadMessages: z.object({ params }),
};
