import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { LOADING_POINT_STATUSES } from './utils/loading-point.types';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number');

const loadingPointAddress = {
  title: z.string().trim().min(1).max(150),
  addressLine1: z.string().trim().min(1).max(255),
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
  create: z.object({
    body: z.object(loadingPointAddress).strict(),
  }),
  update: z.object({
    params,
    body: z
      .object({
        title: loadingPointAddress.title.optional(),
        addressLine1: loadingPointAddress.addressLine1.optional(),
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
