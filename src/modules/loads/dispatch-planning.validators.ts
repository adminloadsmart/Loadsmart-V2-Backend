import { z } from 'zod';
import { FREIGHT_MODES } from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ requisitionId: uuid });

const cargoMixLine = z
  .object({
    productId: uuid,
    tonnesPerTruck: z.number().positive(), // V-13
  })
  .strict();

const ownFleetLine = z
  .object({
    sourceType: z.literal('own_fleet'),
    vehicleIds: z.array(uuid).min(1), // V-10
    cargoMix: z.array(cargoMixLine).min(1),
  })
  .strict();

const marketLine = z
  .object({
    sourceType: z.literal('market'),
    truckTypeId: uuid, // V-11 — the 3-step picker collapses to one id server-side
    numberOfTrucks: z.number().int().min(1).max(50), // V-12
    cargoMix: z.array(cargoMixLine).min(1),
    freightMode: z.enum(FREIGHT_MODES),
    expectedRate: z.number().positive().optional(),
    advancePercentage: z.number().min(0).max(100).default(30),
    balancePercentage: z.number().min(0).max(100).default(70),
  })
  .strict()
  .refine(
    // V-15 — a price is mandatory unless the caller is asking Loadsmart/the market to quote.
    (line) => line.freightMode !== 'set_expected_price' || line.expectedRate !== undefined,
    {
      message: 'expectedRate is required when freightMode is "set_expected_price"',
      path: ['expectedRate'],
    },
  );

const override = z
  .object({
    checkId: z.literal('C03'),
    reason: z.string().trim().min(15), // V-17
  })
  .strict();

export const dispatchPlanningValidators = {
  plan: z.object({
    params,
    body: z
      .object({
        truckLines: z.array(z.discriminatedUnion('sourceType', [ownFleetLine, marketLine])).min(1), // V-16
        overrides: z.array(override).max(1).optional(),
      })
      .strict(),
  }),
};
