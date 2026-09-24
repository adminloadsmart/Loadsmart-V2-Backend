import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { isoDateSchema as isoDate } from '../../shared/utils/date';
import { DATE_FILTERS } from '../../shared/utils/date-filter';
import {
  MAINTENANCE_JOB_TYPES,
  TYRE_CASING_CONDITIONS,
  TYRE_REMOVAL_REASONS,
} from './maintenance.types';

const uuid = z.string().uuid();
const isoDateTime = z.iso.datetime();
const money = z.number().nonnegative().max(9999999999);
const odometerKm = z.number().int().nonnegative().max(9999999);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/** Same filter/from/to shape and rules as dashboards.validators.ts's getLoadsSummary. */
const periodFields = {
  filter: z.enum(DATE_FILTERS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
};

function checkPeriod(
  data: { filter?: string; from?: string; to?: string },
  ctx: z.core.$RefinementCtx,
) {
  if (data.filter === 'custom' && (!data.from || !data.to)) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'from and to are required when filter is custom',
    });
  }
  if (data.from && data.to && data.from > data.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be on/after from' });
  }
}

const part = z
  .object({
    name: z.string().trim().min(1).max(150),
    quantity: z.number().positive().max(9999).default(1),
    cost: money.optional(),
  })
  .strict();

const costFields = {
  labourCost: money.optional(),
  partsCost: money.optional(),
  partsReplaced: z.array(part).max(100).optional(),
};

const locationFields = {
  locationLabel: optionalText(255),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

export const maintenanceValidators = {
  getOverview: z.object({ query: z.object(periodFields).superRefine(checkPeriod) }),
  listJobs: z.object({
    query: pagination
      .extend({
        ...periodFields,
        vehicleId: uuid.optional(),
        jobType: z.enum(MAINTENANCE_JOB_TYPES).optional(),
      })
      .superRefine(checkPeriod),
  }),

  logService: z.object({
    body: z
      .object({
        vehicleId: uuid,
        startedAt: isoDateTime.optional(),
        // Omit to check the truck in (it leaves dispatch until POST /services/:jobId/complete);
        // send it to record a service that already happened.
        completedAt: isoDateTime.optional(),
        odometerKm,
        workshopName: optionalText(150),
        description: optionalText(2000),
        ...costFields,
      })
      .strict(),
  }),

  openBreakdown: z.object({
    body: z
      .object({
        vehicleId: uuid,
        occurredAt: isoDateTime.optional(),
        odometerKm: odometerKm.optional(),
        ...locationFields,
        towed: z.boolean().optional(),
        workshopName: optionalText(150),
        description: optionalText(2000),
        sourceIssueReportId: uuid.optional(),
        ...costFields,
      })
      .strict(),
  }),

  completeService: z.object({
    params: z.object({ jobId: uuid }),
    body: z
      .object({
        completedAt: isoDateTime.optional(),
        odometerKm,
        workshopName: optionalText(150),
        description: optionalText(2000),
        ...costFields,
      })
      .strict(),
  }),

  updateService: z.object({
    params: z.object({ jobId: uuid }),
    body: z
      .object({
        workshopName: optionalText(150),
        description: optionalText(2000),
        ...costFields,
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),

  updateBreakdown: z.object({
    params: z.object({ jobId: uuid }),
    body: z
      .object({
        ...locationFields,
        towed: z.boolean().optional(),
        workshopName: optionalText(150),
        description: optionalText(2000),
        ...costFields,
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),

  closeBreakdown: z.object({
    params: z.object({ jobId: uuid }),
    body: z
      .object({
        closedAt: isoDateTime.optional(),
        odometerKm: odometerKm.optional(),
        description: optionalText(2000),
        // The due service was also done on this visit — resets the service clock.
        serviceCompleted: z.boolean().optional(),
        ...costFields,
      })
      .strict()
      .refine((data) => !data.serviceCompleted || data.odometerKm !== undefined, {
        message: 'odometerKm is required when serviceCompleted is true',
        path: ['odometerKm'],
      })
      .default({}),
  }),

  setServicePolicy: z.object({
    params: z.object({ vehicleId: uuid }),
    body: z
      .object({
        serviceIntervalKm: z.number().int().positive().max(999999),
        serviceIntervalMonths: z.number().int().positive().max(120),
      })
      .strict(),
  }),

  fitTyre: z.object({
    body: z
      .object({
        vehicleId: uuid,
        position: z.string().trim().min(1).max(20),
        serialNumber: optionalText(50),
        brand: optionalText(100),
        originalTreadMm: z.number().positive().max(40),
        fittedAt: isoDate.optional(),
        fittedOdometerKm: odometerKm.optional(),
        retreadCount: z.number().int().min(0).max(10).optional(),
        maxRetreads: z.number().int().min(0).max(10).optional(),
      })
      .strict(),
  }),

  recordTyreReading: z.object({
    params: z.object({ tyreId: uuid }),
    body: z
      .object({
        treadMm: z.number().min(0).max(40),
        readingDate: isoDate.optional(),
        odometerKm: odometerKm.optional(),
      })
      .strict(),
  }),

  removeTyre: z.object({
    params: z.object({ tyreId: uuid }),
    body: z
      .object({
        reason: z.enum(TYRE_REMOVAL_REASONS),
        removedAt: isoDate.optional(),
        odometerKm: odometerKm.optional(),
        casingCondition: z.enum(TYRE_CASING_CONDITIONS).optional(),
      })
      .strict(),
  }),

  registerBatteryPack: z.object({
    body: z
      .object({
        vehicleId: uuid,
        serialNumber: optionalText(50),
        capacityKwh: z.number().positive().max(99999).optional(),
        warrantyStart: isoDate,
        warrantyEnd: isoDate,
        warrantySohFloorPct: z.number().positive().max(100).optional(),
      })
      .strict(),
  }),

  recordBatteryReading: z.object({
    params: z.object({ packId: uuid }),
    body: z
      .object({
        readingMonth: isoDate,
        sohPct: z.number().min(0).max(100),
        odometerKm: odometerKm.optional(),
      })
      .strict(),
  }),
};
