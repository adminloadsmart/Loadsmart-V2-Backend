import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';

const uuid = z.string().uuid();
const vehicleParams = z.object({ vehicleId: uuid });
const driverParams = z.object({ driverId: uuid });
const linkParams = z.object({ linkId: uuid });

export const fleetDriverLinkValidators = {
  linkDriver: z.object({
    params: vehicleParams,
    body: z.object({
      driverId: uuid,
      isPrimary: z.boolean().optional(),
      linkedFrom: isoDate.optional(),
    }),
  }),
  listVehicleLinks: z.object({ params: vehicleParams }),
  listDriverLinks: z.object({ params: driverParams }),
  setLinkPrimary: z.object({ params: linkParams }),
  endLink: z.object({
    params: linkParams,
    body: z.object({ linkedTo: isoDate.optional() }),
  }),
  deleteLink: z.object({ params: linkParams }),
};
