import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import {
  GEOFENCE_ALERT_CHANNELS,
  GEOFENCE_SHAPES,
  GEOFENCE_TYPES,
  MAX_GEOFENCE_RADIUS_M,
  MAX_POLYGON_POINTS,
  MIN_GEOFENCE_RADIUS_M,
} from './utils/geofence.types';

const uuid = z.string().uuid();
const params = z.object({ geofenceId: uuid });

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const minutes = z.number().int().min(1).max(1440);

const point = z.object({ latitude, longitude }).strict();

const alerts = z
  .object({
    onEnter: z.boolean().default(true),
    onExit: z.boolean().default(true),
    dwellMinutes: minutes.nullable().optional(),
    engineOnMinutes: minutes.nullable().optional(),
  })
  .strict();

const appliesTo = z
  .object({
    allVehicles: z.boolean(),
    vehicleIds: z.array(uuid).max(500).optional(),
  })
  .strict();

const recipient = z
  .object({
    userId: uuid,
    channels: z.array(z.enum(GEOFENCE_ALERT_CHANNELS)).min(1).default(['app']),
  })
  .strict();

// Cross-field rules (circle needs a radius, polygon needs vertices, the master-point links only
// make sense on loading/unloading types) are checked in GeofenceService against the merged
// result — create and PATCH share them, and a PATCH can't see the stored row from here.
const fields = z.object({
  name: z.string().trim().min(1).max(150),
  type: z.enum(GEOFENCE_TYPES),
  address: z.string().trim().max(500).nullable().optional(),
  latitude,
  longitude,
  shape: z.enum(GEOFENCE_SHAPES).default('circle'),
  radiusM: z
    .number()
    .int()
    .min(MIN_GEOFENCE_RADIUS_M)
    .max(MAX_GEOFENCE_RADIUS_M)
    .nullable()
    .optional(),
  polygon: z.array(point).min(3).max(MAX_POLYGON_POINTS).nullable().optional(),
  alerts: alerts.default({ onEnter: true, onExit: true }),
  appliesTo: appliesTo.default({ allVehicles: true }),
  recipients: z.array(recipient).max(50).default([]),
  loadingPointId: uuid.nullable().optional(),
  customerDeliveryPointId: uuid.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const geofenceValidators = {
  create: z.object({ body: fields.strict() }),
  // No defaults on PATCH — an omitted block must mean "leave as is", not "reset to default".
  update: z.object({
    params,
    body: z
      .object({
        name: fields.shape.name,
        type: fields.shape.type,
        address: fields.shape.address,
        latitude,
        longitude,
        shape: z.enum(GEOFENCE_SHAPES),
        radiusM: fields.shape.radiusM,
        polygon: fields.shape.polygon,
        alerts,
        appliesTo,
        recipients: z.array(recipient).max(50),
        loadingPointId: fields.shape.loadingPointId,
        customerDeliveryPointId: fields.shape.customerDeliveryPointId,
        isActive: z.boolean(),
      })
      .partial()
      .strict(),
  }),
  list: z.object({
    query: pagination.extend({
      type: z.enum(GEOFENCE_TYPES).optional(),
      isActive: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
    }),
  }),
  get: z.object({ params }),
  delete: z.object({ params }),
};
