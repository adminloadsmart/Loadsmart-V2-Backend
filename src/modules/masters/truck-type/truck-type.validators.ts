import { z } from 'zod';
import { TRUCK_BODY_TYPES } from './truck-type.types';
import { WHEEL_COUNTS } from '../vehicle/vehicle.type';

const uuid = z.string().uuid();
const truckTypeParams = z.object({ truckTypeId: uuid });

export const truckTypeValidators = {
  listTruckTypes: z.object({}),
  createTruckType: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(100),
      // 3-step picker (Plan Dispatch v2.0 §6.6) — all mandatory for a directly-created truck
      // type; rows added via "Add from catalog" (addTruckTypesFromCatalog below) skip these and
      // are edited in later, since the catalog only ever supplies a name.
      bodyType: z.enum(TRUCK_BODY_TYPES),
      wheelConfiguration: z
        .number()
        .refine(
          (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
          'Invalid wheel configuration',
        ),
      capacityTons: z.number().positive(),
      deckVolumeCubicMeters: z.number().positive(),
    }),
  }),
  deleteTruckType: z.object({ params: truckTypeParams }),
  // Market Fleet's 3-step picker — body type, then wheel configuration, then capacity — resolved
  // directly to a usable truckTypeId (get-or-create against this tenant's list).
  resolveTruckType: z.object({
    body: z.object({
      bodyType: z.enum(TRUCK_BODY_TYPES),
      wheelConfiguration: z
        .number()
        .refine(
          (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
          'Invalid wheel configuration',
        ),
      capacityTons: z.number().positive(),
    }),
  }),
  listTruckTypeCatalog: z.object({}),
  addTruckTypesFromCatalog: z.object({
    body: z.object({
      names: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    }),
  }),
};
