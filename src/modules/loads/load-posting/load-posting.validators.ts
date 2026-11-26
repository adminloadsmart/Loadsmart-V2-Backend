import { z } from 'zod';
import { isoDateSchema } from '../../../shared/utils/date';
import {
  BALANCE_PAID_BY,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  POST_MODES,
  PRICE_BASES,
  PRICE_MODES,
} from './utils/load-posting.types';

import { AXLE_TYPES } from '../../masters/vehicle/vehicle.type';
import { PICKER_BODIES } from '../../masters/vehicle/truck-type-picker.constants';
import { truckPickSchema } from '../../masters/truck-type/truck-type.validators';
import { MAX_CARGO_VALUE_PER_TONNE } from '../utils/loads.types';

const uuid = z.string().uuid();
/** Same rule as the Transporter master's phone. */
const transporterPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number');
const packaging = z.enum(['bags', 'drums', 'pallets', 'pieces', 'boxes', 'cartons', 'tonnes']);
const dateTime = z.string().datetime({ offset: true });

/** The IST calendar day of a moment, YYYY-MM-DD. */
const istDate = (at: Date) => new Date(at.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
/** Area-level parts of an address — the city and state stay as posted. */
const addressArea = z
  .object({
    addressLine1: z.string().trim().min(1).max(255).optional(),
    areaLocality: z.string().trim().min(1).max(255).optional(),
    pinCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'A 6-digit PIN code')
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((area) => Object.keys(area).length > 0, { message: 'Nothing to change' });

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

/** 0 (or null) means "No advance"; otherwise a whole number 1–100. */
const advancePercentage = z
  .number()
  .int('Enter a percentage from 1 to 100')
  .min(0, 'Enter a percentage from 1 to 100')
  .max(100, 'Enter a percentage from 1 to 100')
  .nullable()
  .transform((v) => v ?? 0);

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
    unloadingAppointment: z
      .object({
        appointmentId: z.string().trim().min(1).max(60),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
        slot: z.string().trim().min(1).max(40),
      })
      .strict()
      .optional(),
    commodity,
    packaging,
    weightTonnes: z.number().positive().optional(),
    // Optional value of the cargo per MT — a shortage's value at risk (LS_N_0034).
    cargoValuePerTonne: z.number().positive().max(MAX_CARGO_VALUE_PER_TONNE).optional(),
    truckCount: z.number().int().min(1).default(1),
    truck: truckPickSchema.optional(),
    acceptedTrucks: z.array(truckPickSchema).max(10).optional(),
    vehicleId: uuid.optional(),
    /** Own fleet: overrides the truck's linked driver (must be idle). */
    driverId: uuid.optional(),
    transporterIds: z.array(uuid).max(100).optional(),
    transporterId: uuid.optional(),
    price: price.optional(),
    advancePercentage: advancePercentage.optional(),
    balancePaidBy: z.enum(BALANCE_PAID_BY).optional(),
    note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
    title: z.string().trim().max(TITLE_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // PL-14 — Deliver by is optional but must be after pickup.
    if (body.deliverByAt && Date.parse(body.deliverByAt) <= Date.parse(body.pickupAt)) {
      fail('deliverByAt', 'Deliver by must be after pickup');
    }
    // Deliver by and the warehouse appointment are two ways to say when the load is due.
    if (body.deliverByAt && body.unloadingAppointment) {
      fail('unloadingAppointment', 'Give a deliver-by time or a warehouse appointment, not both');
    }
    if (
      body.unloadingAppointment &&
      body.unloadingAppointment.date < istDate(new Date(body.pickupAt))
    ) {
      fail('unloadingAppointment', 'The appointment date must be on or after the pickup date');
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
    if (!body.truck) fail('truck', 'Truck type is required');
    // PL-16 — every accepted size shares the main truck's body (all open or all closed).
    if (body.truck && body.acceptedTrucks?.some((t) => t.body !== body.truck!.body)) {
      fail('acceptedTrucks', 'Also-accept sizes must have the same body type as the main truck');
    }
    if (body.advancePercentage === undefined) fail('advancePercentage', 'Advance is required');
    if (body.vehicleId) fail('vehicleId', 'A truck of your own is only for Own fleet');
    if (body.driverId) fail('driverId', 'A driver is only picked for Own fleet');

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

/** What can change once bids are in: the reporting time and the pickup / drop area. Shared by the
 *  shipper's edit and Loadsmart Tracking's edit of a load on its desk. */
export const editDetailsBody = z
  .object({
    pickupAt: dateTime.optional(),
    pickupArea: addressArea.optional(),
    dropArea: addressArea.optional(),
  })
  .strict()
  .refine((body) => body.pickupAt || body.pickupArea || body.dropArea, {
    message: 'Send the reporting time, the pickup area or the drop area',
  })
  .refine(
    (body) => {
      if (!body.pickupAt) return true;
      const at = new Date(body.pickupAt);
      return (at.getUTCMinutes() === 0 || at.getUTCMinutes() === 30) && at.getUTCSeconds() === 0;
    },
    { message: 'Pickup time must be on the hour or half hour', path: ['pickupAt'] },
  );

export const loadPostingValidators = {
  post: z.object({ body: postLoadBody }),
  // Edit a posted load: everything until bids come in (the posting form again) …
  editPosting: z.object({ params: z.object({ postingId: uuid }), body: postLoadBody }),
  // … then only the reporting time and the area of the pickup and drop (never the city/state).
  editDetails: z.object({
    params: z.object({ postingId: uuid }),
    body: editDetailsBody,
  }),
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
  // With loadId, each recipient also carries its bid and its step on that load ("Who is quoting").
  getPosting: z.object({
    params: z.object({ postingId: uuid }),
    query: z.object({ loadId: uuid.optional() }),
  }),
  unloadingPoints: z.object({
    params: z.object({ customerId: uuid }),
    query: z.object({ search: z.string().trim().min(1).optional() }),
  }),
  loadingPoints: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  transporters: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  quickAddTransporter: z.object({
    body: z.object({ name: z.string().trim().min(1).max(150), phone: transporterPhone }).strict(),
  }),
  updateTransporterPhone: z.object({
    params: z.object({ transporterId: uuid }),
    body: z.object({ phone: transporterPhone }).strict(),
  }),
  commodities: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  truckOptions: z.object({
    query: z.object({
      body: z.enum(PICKER_BODIES).optional(),
      // "6" or "mxl" — a digit string is a tyre count, anything else must be an axle type.
      wheel: z.union([z.enum(AXLE_TYPES), z.coerce.number().int().positive()]).optional(),
      capacityTons: z.coerce.number().positive().optional(),
    }),
  }),
  availableDrivers: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  fleetOptions: z.object({ query: z.object({ search: z.string().trim().min(1).optional() }) }),
  /** Indent picker: Masters → Contracts on the load's lane corridor (city + state both ends). */
  listContracts: z.object({
    query: z.object({
      customerId: uuid.optional(),
      pickupCity: z.string().trim().min(1),
      pickupState: z.string().trim().min(1),
      dropCity: z.string().trim().min(1),
      dropState: z.string().trim().min(1),
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
        /** What the transporter owes if it rejects an indent; leave out for none. */
        nonPlacementPenalty: z.number().nonnegative().optional(),
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
