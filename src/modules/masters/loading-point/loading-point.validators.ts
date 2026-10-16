import { z } from 'zod';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { LOADING_POINT_STATUSES } from './loading-point.types';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number');

/** 'HH:mm', 00:00–23:59, plus 24:00 for a gate open until midnight. */
const gateTime = z
  .string()
  .trim()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Expected a time as HH:mm');

const loadingPointAddress = {
  title: z.string().trim().min(1).max(150),
  addressLine1: z.string().trim().min(1).max(255).optional(),
  addressLine2: z.string().trim().max(255).optional(),
  landmark: z.string().trim().max(255).optional(),
  areaLocality: z.string().trim().max(255).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pinCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  contactPersonName: z.string().trim().max(150).optional(),
  contactPersonNumber: phone.optional(),
  contactPersonEmail: z.string().trim().email().max(255).optional(),
  googlePlaceId: z.string().trim().min(1).max(255).optional(),
  geofenceRadiusM: z.number().int().min(50).max(5000).optional(),
  gateOpensAt: gateTime.optional(),
  gateClosesAt: gateTime.optional(),
  notes: z.string().trim().max(2000).optional(),
};

const params = z.object({ loadingPointId: uuid });

export const loadingPointValidators = {
  list: z.object({
    query: pagination.extend({
      search: z.string().min(1).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      status: z.enum(LOADING_POINT_STATUSES).optional(),
    }),
  }),
  get: z.object({ params }),
  export: z.object({
    query: z.object({
      search: z.string().min(1).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      status: z.enum(LOADING_POINT_STATUSES).optional(),
    }),
  }),
  listCities: z.object({
    query: z.object({ status: z.enum(LOADING_POINT_STATUSES).optional() }),
  }),
  create: z.object({
    body: z.object(loadingPointAddress).strict(),
  }),
  update: z.object({
    params,
    body: z
      .object({
        title: loadingPointAddress.title.optional(),
        addressLine1: loadingPointAddress.addressLine1.nullable(),
        googlePlaceId: loadingPointAddress.googlePlaceId.nullable(),
        geofenceRadiusM: loadingPointAddress.geofenceRadiusM,
        gateOpensAt: loadingPointAddress.gateOpensAt.nullable(),
        gateClosesAt: loadingPointAddress.gateClosesAt.nullable(),
        notes: loadingPointAddress.notes.nullable(),
        addressLine2: loadingPointAddress.addressLine2.nullable().optional(),
        landmark: loadingPointAddress.landmark.nullable().optional(),
        areaLocality: loadingPointAddress.areaLocality.nullable().optional(),
        city: loadingPointAddress.city.optional(),
        state: loadingPointAddress.state.optional(),
        pinCode: loadingPointAddress.pinCode.optional(),
        latitude: loadingPointAddress.latitude.nullable().optional(),
        longitude: loadingPointAddress.longitude.nullable().optional(),
        contactPersonName: loadingPointAddress.contactPersonName.nullable().optional(),
        contactPersonNumber: loadingPointAddress.contactPersonNumber.nullable().optional(),
        contactPersonEmail: loadingPointAddress.contactPersonEmail.nullable().optional(),
        status: z.enum(['active', 'inactive']).optional(),
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  approve: z.object({ params }),
  reject: z.object({
    params,
    body: z.object({ reason: z.string().trim().min(1) }),
  }),
  delete: z.object({ params }),
};
