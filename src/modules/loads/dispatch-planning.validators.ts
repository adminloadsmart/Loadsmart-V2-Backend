import { z } from 'zod';

const uuid = z.string().uuid();
const params = z.object({ requisitionId: uuid });

const ownFleetLine = z
  .object({
    sourceType: z.literal('own_fleet'),
    vehicleId: uuid,
  })
  .strict();

const marketLine = z
  .object({
    sourceType: z.literal('market'),
    transporterId: uuid,
    truckTypeId: uuid,
    feetWheels: z.string().trim().max(50).optional(),
    capacityTonnes: z.number().positive(),
    numberOfTrucks: z.number().int().positive().max(200),
  })
  .strict();

export const dispatchPlanningValidators = {
  plan: z.object({
    params,
    body: z
      .object({
        truckLines: z.array(z.discriminatedUnion('sourceType', [ownFleetLine, marketLine])).min(1),
      })
      .strict(),
  }),
};
