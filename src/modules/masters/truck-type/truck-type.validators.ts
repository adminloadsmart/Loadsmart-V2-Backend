import { z } from 'zod';
import { ACTIVE_TRUCK_BODY_TYPES } from './truck-type.types';
import { AXLE_TYPES, WHEEL_COUNTS } from '../vehicle/vehicle.type';
import { findPickerRow, PICKER_BODIES } from '../vehicle/truck-type-picker.constants';

const uuid = z.string().uuid();
const truckTypeParams = z.object({ truckTypeId: uuid });

/** A tyre count (number) or an axle type, as the picker's step 2 offers. */
const pickerWheel = z.union([z.number().int().positive(), z.enum(AXLE_TYPES)]);

/** One truck-type pick (body → tyres/axle → tonnes → feet); must be a combination the fixed
 *  picker table (the client's truck-type list) actually offers. Shared with load posting. */
export const truckPickSchema = z
  .object({
    body: z.enum(PICKER_BODIES),
    wheel: pickerWheel,
    capacityTons: z.number().positive(),
    bodyLengthFt: z.string().trim().min(1).max(20),
  })
  .strict()
  .refine((pick) => findPickerRow(pick) !== null, 'Not a truck type we offer');

export const truckTypeValidators = {
  listTruckTypes: z.object({}),
  createTruckType: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(100),
      // All mandatory for a directly-created truck type; rows added via "Add from catalog"
      // (addTruckTypesFromCatalog below) get these from the catalog row instead.
      bodyType: z.enum(ACTIVE_TRUCK_BODY_TYPES),
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
  // Market Fleet's picker (body → tyres/axle → tonnes → feet) resolved directly to a usable
  // truckTypeId (get-or-create against this tenant's list).
  resolveTruckType: z.object({ body: truckPickSchema }),
  listTruckTypeCatalog: z.object({}),
  addTruckTypesFromCatalog: z.object({
    body: z.object({
      names: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    }),
  }),
};
