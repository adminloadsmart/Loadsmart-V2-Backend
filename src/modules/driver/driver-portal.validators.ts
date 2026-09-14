import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { updateStatusBody, uploadPodBody } from '../loads/load.validators';
import { DRIVER_OPERATIONAL_STATUSES } from './drivers.types';

const uuid = z.string().uuid();
const loadParams = z.object({ loadId: uuid });

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

  // Same body shape as loads/load.validators.ts's staff-facing schemas — reused directly (not
  // duplicated) so the two can't drift apart. :loadId is present here (unlike the rest of this
  // file) because these act on a load, not the driver's own record; ownership (this load must
  // actually be assigned to req.driver!.id) is enforced in LoadService, not here.
  updateMyLoadStatus: z.object({ params: loadParams, body: updateStatusBody }),
  uploadMyPod: z.object({ params: loadParams, body: uploadPodBody }),

  // Same shape as storage.validators.ts's generateUploadUrl, except `purpose` is pinned to the
  // literal 'trips/pod' — a driver should never request an upload URL for any other storage
  // purpose (masters/driver, kyc, etc.) through this route.
  requestPodUploadUrl: z.object({
    body: z
      .object({
        purpose: z.literal('trips/pod'),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(255),
        sizeBytes: z.coerce.number().int().positive(),
      })
      .strict(),
  }),
  confirmPodUpload: z.object({ params: z.object({ fileId: uuid }) }),
};
