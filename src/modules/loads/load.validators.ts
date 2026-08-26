import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import {
  FREIGHT_TYPES,
  LOAD_SOURCE_TYPES,
  LOAD_STATUSES,
  LOAD_STATUS_GROUPS,
  MANUAL_TRACKING_STATUSES,
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
