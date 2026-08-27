import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import {
  FREIGHT_TYPES,
  LOAD_SOURCE_TYPES,
  LOAD_STATUSES,
  LOAD_STATUS_GROUPS,
  MANUAL_TRACKING_STATUSES,
  SEAL_STATUSES,
} from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

export const loadValidators = {
  list: z.object({
    // `search` (inherited from `pagination`) matches against the load's requisition's customer
    // name — see LoadRepository.list/countByGroup.
    query: pagination
      .extend({
        requisitionId: uuid.optional(),
        status: z.enum(LOAD_STATUSES).optional(),
        // The Trips Home-page tab filter (Active/Completed) — a status-group shorthand, not a
        // narrower version of `status` above, so the two aren't combined in one request.
        group: z.enum(LOAD_STATUS_GROUPS).optional(),
        sourceType: z.enum(LOAD_SOURCE_TYPES).optional(),
        transporterId: uuid.optional(),
        vehicleId: uuid.optional(),
        driverId: uuid.optional(),
      })
      .refine(
        (data) => !(data.status && data.group),
        'Provide at most one of status or group — group is the Trips tab filter (active/completed), status is an exact-value filter',
      ),
  }),
  get: z.object({ params }),
  getActivities: z.object({ params }),

  // Market loads only — own-fleet loads are assigned at Dispatch Planning (Plan Dispatch v2.0
  // R-16) and never reach this endpoint; LoadService.assign() rejects them.
  assign: z.object({
    params,
    body: z
      .object({
        transporterId: uuid,
        vehicleNumber: z.string().trim().min(1).max(20),
        driverNumber: z.string().trim().min(1).max(20),
        freightType: z.enum(FREIGHT_TYPES),
        freightValue: z.number().nonnegative().optional(),
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

  // The delivery receipt — photo, receiver details and the seal check are all captured together
  // in one submission; only podRemarks is optional.
  uploadPod: z.object({
    params,
    body: z
      .object({
        podFileKey: z.string().trim().min(1),
        podReceiverName: z.string().trim().min(1).max(150),
        podReceiverMobile: z
          .string()
          .trim()
          .regex(/^\d{10}$/, 'Must be a 10-digit mobile number'),
        podReceiverDesignation: z.string().trim().min(1).max(150),
        podQuantityReceived: z.number().nonnegative(),
        sealStatus: z.enum(SEAL_STATUSES),
        podRemarks: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),
};
