import { z } from 'zod';
import { isoDateSchema } from '../../../shared/utils/date';
import {
  BALANCE_PAID_BY,
  NOTE_MAX_LENGTH,
  POST_MODES,
  PRICE_BASES,
  PRICE_MODES,
} from './utils/load-posting.types';

const uuid = z.string().uuid();
const packaging = z.enum(['bags', 'drums', 'pallets', 'pieces', 'boxes', 'cartons', 'tonnes']);
const dateTime = z.string().datetime({ offset: true });

const newAddress = z
  .object({
    label: z.string().trim().min(1).max(255),
    addressLine1: z.string().trim().max(255).optional(),
    areaLocality: z.string().trim().max(255).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    // PL-12: six digits that must match a real pincode; the street can stay empty.
    pinCode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    source: z.enum(['google', 'pincode']),
  })
  .strict();

/** Exactly one way to name a place: a saved master row or a new address. */
function exactlyOne(values: unknown[]): boolean {
  return values.filter((value) => value !== undefined).length === 1;
}

const pickup = z
  .object({ loadingPointId: uuid.optional(), newAddress: newAddress.optional() })
  .strict()
  .refine((p) => exactlyOne([p.loadingPointId, p.newAddress]), 'Pick a loading point or add one');

const drop = z
  .object({
    customerDeliveryPointId: uuid.optional(),
    loadingPointId: uuid.optional(),
    newAddress: newAddress.optional(),
  })
  .strict()
  .refine(
    (d) => exactlyOne([d.customerDeliveryPointId, d.loadingPointId, d.newAddress]),
    'Pick an unloading point or add one',
  );

const commodity = z
  .object({ productId: uuid.optional(), name: z.string().trim().min(1).max(255).optional() })
  .strict()
  .refine((c) => exactlyOne([c.productId, c.name]), 'Pick a commodity or add a new name');

const price = z
  .object({
    mode: z.enum(PRICE_MODES),
    basis: z.enum(PRICE_BASES).optional(),
    rate: z.number().positive().optional(),
  })
  .strict();

const advancePercentage = z
  .number()
  .int('Enter a percentage from 1 to 100')
  .min(1, 'Enter a percentage from 1 to 100')
  .max(100, 'Enter a percentage from 1 to 100');

/** Field-level shape only — cross-record rules (pickup lead time, contracts, vehicle state,
 *  body-type match) live in LoadPostingService since they need the database or the clock. */
export const postLoadBody = z
  .object({
    mode: z.enum(POST_MODES),
    customerId: uuid.optional(),
    pickup,
    drop,
    pickupAt: dateTime,
    deliverByAt: dateTime.optional(),
    commodity,
    packaging,
    weightTonnes: z.number().positive().optional(),
    truckCount: z.number().int().min(1).default(1),
    truckTypeId: uuid.optional(),
    truckLengthFt: z.string().trim().min(1).max(20).optional(),
    acceptedTruckTypeIds: z.array(uuid).max(10).optional(),
    vehicleId: uuid.optional(),
    transporterIds: z.array(uuid).max(100).optional(),
    transporterId: uuid.optional(),
    price: price.optional(),
    advancePercentage: advancePercentage.optional(),
    balancePaidBy: z.enum(BALANCE_PAID_BY).optional(),
    note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // PL-14 — Deliver by is optional but must be after pickup.
    if (body.deliverByAt && Date.parse(body.deliverByAt) <= Date.parse(body.pickupAt)) {
      fail('deliverByAt', 'Deliver by must be after pickup');
    }
    // PL-13 — half-hour steps.
    const pickupAt = new Date(body.pickupAt);
    if (
      (pickupAt.getUTCMinutes() !== 0 && pickupAt.getUTCMinutes() !== 30) ||
      pickupAt.getUTCSeconds() !== 0
    ) {
      fail('pickupAt', 'Pickup time must be on the hour or half hour');
    }

    if (body.mode === 'own_fleet') {
      if (!body.vehicleId) fail('vehicleId', 'Pick one of your trucks');
      if (body.truckCount !== 1) fail('truckCount', 'Own fleet moves one truck per load');
      if (body.price || body.advancePercentage !== undefined || body.balancePaidBy) {
        fail('price', 'Own fleet has no price or payment section');
      }
      if (body.transporterIds?.length || body.transporterId) {
        fail('transporterIds', 'Own fleet does not go to transporters');
      }
      return;
    }

    // Market fleet and Indent both need a full truck type and payment terms.
    if (!body.truckTypeId) fail('truckTypeId', 'Truck type is required');
    if (body.advancePercentage === undefined) fail('advancePercentage', 'Advance is required');
    if (body.vehicleId) fail('vehicleId', 'A truck of your own is only for Own fleet');

    if (body.mode === 'indent') {
      if (!body.transporterId) fail('transporterId', 'Pick the contracted transporter');
      if (body.transporterIds?.length) fail('transporterIds', 'Indent goes to one transporter');
      if (body.price) fail('price', 'Indent uses the contract rate and cannot be priced');
      return;
    }

    if (body.transporterId) fail('transporterId', 'transporterId is only for Indent');
    if (!body.price) {
      fail('price', 'Set a target price or ask for quotes');
    } else if (body.price.mode === 'set_target') {
      if (!body.price.rate) fail('price', 'Target price must be more than 0');
      if (!body.price.basis) fail('price', 'Choose per trip or per tonne');
      // PL-17 — weight is optional per trip, required (> 0) per tonne.
      if (body.price.basis === 'per_tonne' && !body.weightTonnes) {
        fail('weightTonnes', 'Add the weight. A per-tonne price needs it.');
      }
    } else if (body.price.rate !== undefined || body.price.basis !== undefined) {
      fail('price', 'Ask for quotes carries no price');
    }
  });

export const loadPostingValidators = {
  post: z.object({ body: postLoadBody }),
  recentCustomers: z.object({
    query: z.object({ limit: z.coerce.number().int().min(1).max(10).default(4) }),
  }),
  customerSearch: z.object({
    query: z.object({
      search: z.string().trim().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(25).default(10),
    }),
  }),
  quickAddCustomer: z.object({
    body: z.object({ name: z.string().trim().min(1).max(150) }).strict(),
  }),
  pastLoads: z.object({ query: z.object({ customerId: uuid.optional() }) }),
  unloadingPoints: z.object({
    params: z.object({ customerId: uuid }),
    query: z.object({ search: z.string().trim().min(1).optional() }),
  }),
  loadingPoints: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  transporters: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  commodities: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  truckOptions: z.object({
    query: z.object({
      bodyType: z.string().min(1).optional(),
      wheelConfiguration: z.coerce.number().int().positive().optional(),
      capacityTons: z.coerce.number().positive().optional(),
    }),
  }),
  fleetOptions: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  listContracts: z.object({
    query: z.object({
      customerId: uuid,
      pickupCity: z.string().trim().min(1).optional(),
      dropCity: z.string().trim().min(1).optional(),
    }),
  }),
  createContract: z.object({
    body: z
      .object({
        customerId: uuid,
        transporterId: uuid,
        contractNumber: z.string().trim().min(1).max(50),
        pickupCity: z.string().trim().min(1).max(100),
        dropCity: z.string().trim().min(1).max(100),
        rate: z.number().positive(),
        validFrom: isoDateSchema,
        validTo: isoDateSchema,
      })
      .strict()
      .refine((c) => c.validTo >= c.validFrom, 'Contract end date must not be before its start'),
  }),
  draftBody: z.object({ body: z.object({ payload: z.record(z.string(), z.unknown()) }).strict() }),
  draftParams: z.object({ params: z.object({ draftId: uuid }) }),
  updateDraft: z.object({
    params: z.object({ draftId: uuid }),
    body: z.object({ payload: z.record(z.string(), z.unknown()) }).strict(),
  }),
};
