import { z } from 'zod';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import {
  FREIGHT_TYPES,
  LOAD_SOURCE_TYPES,
  LOAD_STATUSES,
  LOAD_STATUS_GROUPS,
  MANUAL_TRACKING_STATUSES,
  POD_STATUSES,
  POD_REVIEW_DECISIONS,
  SEAL_STATUSES,
  SHORTAGE_OR_DAMAGE_STATUSES,
} from './utils/loads.types';

const uuid = z.string().uuid();
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const params = z.object({ loadId: uuid });

// Exported so driver-portal.validators.ts's driver-facing status/POD schemas can reuse the exact
// same body shape instead of a hand-kept duplicate that could drift out of sync.
export const updateStatusBody = z.object({ toStatus: z.enum(MANUAL_TRACKING_STATUSES) }).strict();

// Any subset of the three mandatory document pairs may be submitted per call — invoice/e-way
// bill/E-LR can be uploaded one at a time or all together (LoadService.confirmLoading only flips
// the load to loading_confirmed once all three end up present on the row, whether accumulated
// across calls or already present from an earlier caller — a document already on the load never
// needs to be resent). loadingPhotoFileKeys/weighingSlipFileKey are non-mandatory and never gate
// that flip. Exported so driver-portal.validators.ts's confirmMyLoading reuses the exact same
// body shape instead of a hand-kept duplicate that could drift out of sync.
export const confirmLoadingBody = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(50).optional(),
    invoiceFileKey: z.string().trim().min(1).optional(),
    ewayBillNumber: z.string().trim().min(1).max(50).optional(),
    ewayBillFileKey: z.string().trim().min(1).optional(),
    elrNumber: z.string().trim().max(50).optional(),
    elrFileKey: z.string().trim().min(1).optional(),
    loadingPhotoFileKeys: z.array(z.string().trim().min(1)).max(3).optional(),
    weighingSlipFileKey: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (data) => (data.invoiceNumber === undefined) === (data.invoiceFileKey === undefined),
    'invoiceNumber and invoiceFileKey must be submitted together',
  )
  .refine(
    (data) => (data.ewayBillNumber === undefined) === (data.ewayBillFileKey === undefined),
    'ewayBillNumber and ewayBillFileKey must be submitted together',
  )
  .refine(
    (data) => data.elrNumber === undefined || data.elrFileKey !== undefined,
    'elrNumber cannot be submitted without elrFileKey',
  )
  .refine(
    (data) =>
      data.invoiceFileKey !== undefined ||
      data.ewayBillFileKey !== undefined ||
      data.elrFileKey !== undefined ||
      data.loadingPhotoFileKeys !== undefined ||
      data.weighingSlipFileKey !== undefined,
    'At least one document must be submitted',
  );

// Driver-app "send the receiver a code" step — see LoadService.sendPodReceiverCode.
export const sendPodReceiverCodeBody = z
  .object({
    mobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'Must be a 10-digit mobile number'),
  })
  .strict();

export const uploadPodBody = z
  .object({
    podFileKey: z.string().trim().min(1),
    podReceiverName: z.string().trim().min(1).max(150),
    // Optional: a receiver without a phone skips code verification and the POD photo alone is the
    // proof. When a driver sends it, podReceiverCode is required — see LoadService.uploadPod.
    podReceiverMobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'Must be a 10-digit mobile number')
      .optional(),
    podReceiverCode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Must be the 4-digit code sent to the receiver')
      .optional(),
    // Optional as of the driver-app ePOD screen redesign — that screen doesn't collect either of
    // these, but a staff-side or older caller may still send them.
    podReceiverDesignation: z.string().trim().min(1).max(150).optional(),
    podQuantityReceived: z.number().nonnegative(),
    sealStatus: z.enum(SEAL_STATUSES).optional(),
    // Cargo-condition-on-arrival — see SHORTAGE_OR_DAMAGE_STATUSES' doc comment (loads.types.ts).
    // numberOfTonnesShort is accepted regardless of shortageOrDamage's value (no server-side
    // requirement tying it to 'shortage'/'both' — the client's own UI decides when to show/
    // require it). damagePhotoKey IS enforced server-side, below, when damage is reported.
    shortageOrDamage: z.enum(SHORTAGE_OR_DAMAGE_STATUSES).optional(),
    numberOfTonnesShort: z.number().nonnegative().optional(),
    damagePhotoKey: z.string().trim().min(1).optional(),
    podRemarks: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      (data.shortageOrDamage === 'damage' ||
        data.shortageOrDamage === 'wet' ||
        data.shortageOrDamage === 'both') &&
      !data.damagePhotoKey
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['damagePhotoKey'],
        message: 'damagePhotoKey is required when shortageOrDamage is damage, wet or both',
      });
    }
    if (data.podReceiverCode && !data.podReceiverMobile) {
      ctx.addIssue({
        code: 'custom',
        path: ['podReceiverMobile'],
        message: 'podReceiverMobile is required when podReceiverCode is sent',
      });
    }
  });

// Staff's accept/reject decision on a pending E-POD — see LoadService.reviewPod. `reason` is
// required when rejecting (so the driver knows what to fix on resubmission), unused otherwise.
export const reviewPodBody = z
  .object({
    decision: z.enum(POD_REVIEW_DECISIONS),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.decision === 'rejected' && !data.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason is required when decision is rejected',
      });
    }
  });

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
        podStatus: z.enum(POD_STATUSES).optional(),
        fromDate: dateOnly.optional(),
        toDate: dateOnly.optional(),
      })
      .refine(
        (data) => !(data.fromDate && data.toDate) || data.fromDate <= data.toDate,
        'fromDate must not be after toDate',
      )
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
        driverNumber: z.string().trim().min(1).max(20).optional(),
        driverName: z.string().trim().min(1).max(150).optional(),
        freightType: z.enum(FREIGHT_TYPES),
        freightValue: z.number().nonnegative().optional(),
      })
      .strict(),
  }),

  confirmLoading: z.object({
    params,
    body: confirmLoadingBody,
  }),

  // Same body shape as confirmLoading above (same document set), but no status-transition
  // semantics — see LoadService.updateDocuments.
  updateDocuments: z.object({
    params,
    body: confirmLoadingBody,
  }),

  updateStatus: z.object({
    params,
    body: updateStatusBody,
  }),

  // The delivery receipt — photo, receiver details and the seal check are all captured together
  // in one submission; only podRemarks is optional.
  uploadPod: z.object({
    params,
    body: uploadPodBody,
  }),

  reviewPod: z.object({
    params,
    body: reviewPodBody,
  }),
};
