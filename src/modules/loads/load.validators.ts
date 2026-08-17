import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import {
  FREIGHT_TYPES,
  LOAD_SOURCE_TYPES,
  LOAD_STATUSES,
  MANUAL_TRACKING_STATUSES,
} from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

export const loadValidators = {
  list: z.object({
    query: pagination.extend({
      requisitionId: uuid.optional(),
      status: z.enum(LOAD_STATUSES).optional(),
      sourceType: z.enum(LOAD_SOURCE_TYPES).optional(),
      transporterId: uuid.optional(),
      vehicleId: uuid.optional(),
    }),
  }),
  get: z.object({ params }),
  getActivities: z.object({ params }),

  // Required-ness of most fields depends on the load's own_fleet/market sourceType, which isn't
  // known at request-validation time — LoadService.assign enforces that conditionally.
  assign: z.object({
    params,
    body: z
      .object({
        vehicleId: uuid.optional(),
        driverId: uuid.optional(),
        vehicleNumber: z.string().trim().min(1).max(20).optional(),
        driverNumber: z.string().trim().min(1).max(20).optional(),
        transporterId: uuid.optional(),
        freightType: z.enum(FREIGHT_TYPES).optional(),
        freightValue: z.number().nonnegative().optional(),
        advancePercentage: z.number().min(0).max(100).optional(),
        balancePercentage: z.number().min(0).max(100).optional(),
      })
      .strict(),
  }),

  confirmLoading: z.object({
    params,
    body: z
      .object({
        invoiceNumber: z.string().trim().min(1).max(50),
        invoiceFileKey: z.string().trim().min(1),
        ewayBillNumber: z.string().trim().min(1).max(50),
        ewayBillFileKey: z.string().trim().min(1),
        elrNumber: z.string().trim().max(50).optional(),
        elrFileKey: z.string().trim().min(1),
      })
      .strict(),
  }),

  updateStatus: z.object({
    params,
    body: z.object({ toStatus: z.enum(MANUAL_TRACKING_STATUSES) }).strict(),
  }),

  uploadPod: z.object({
    params,
    body: z
      .object({
        podFileKey: z.string().trim().min(1).optional(),
        podReceiverName: z.string().trim().min(1).max(150).optional(),
        podQuantityReceived: z.number().nonnegative().optional(),
        podRemarks: z.string().trim().max(500).optional(),
      })
      .strict()
      .refine(
        (data) =>
          Boolean(data.podFileKey) !==
          Boolean(data.podReceiverName && data.podQuantityReceived !== undefined),
        'Provide exactly one of a POD document (podFileKey) or a filled POD form (podReceiverName + podQuantityReceived)',
      ),
  }),
};
