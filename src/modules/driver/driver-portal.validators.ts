import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { DRIVER_OPERATIONAL_STATUSES } from './drivers.types';

// No :driverId param anywhere here, unlike driver.validators.ts's staff-facing schemas — every
// endpoint is implicitly scoped to req.driver!.id (see driver-portal.controller.ts). See
// docs/driver-auth.md.
export const driverPortalValidators = {
  updateMyStatus: z.object({
    body: z.object({
      operationalStatus: z.enum(DRIVER_OPERATIONAL_STATUSES),
      reason: z.string().trim().min(1).max(255).optional(),
    }),
  }),
  listMyLoads: z.object({
    query: pagination,
  }),
};
