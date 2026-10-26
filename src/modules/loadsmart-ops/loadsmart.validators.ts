import { z } from 'zod';
import { isoDateSchema } from '../../shared/utils/date';
import { MANUAL_TRACKING_STATUSES, POD_REVIEW_DECISIONS } from '../loads/utils/loads.types';
import { confirmLoadingBody } from '../loads/load.validators';
import { CHARGE_TYPES, PARTNER_STATUSES, PARTNER_TYPES } from './loadsmart.types';

const uuid = z.string().uuid();
const loadParams = z.object({ loadId: uuid });
const sourcingParams = z.object({ sourcingId: uuid });
const mobile = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Must be a 10-digit mobile number');
const percent = z.number().min(0).max(100);
const money = z.number().nonnegative();
const utr = z.object({ utrReference: z.string().trim().min(1).max(100) }).strict();

const partnerBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    phone: mobile,
    partnerType: z.enum(PARTNER_TYPES),
    status: z.enum(PARTNER_STATUSES).optional(),
    tdsPercent: percent.optional(),
    bankAccountNumber: z.string().trim().min(5).max(30).optional(),
    bankIfsc: z.string().trim().length(11).optional(),
    upiId: z.string().trim().min(3).max(100).optional(),
  })
  .strict();

/** Ops console (/v1/loadsmart-ops) and the shipper's Loadsmart routes on /v1/loads. */
export const loadsmartValidators = {
  empty: z.object({}),
  load: z.object({ params: loadParams }),
  sourcing: z.object({ params: sourcingParams }),

  createPartner: z.object({ body: partnerBody }),
  updatePartner: z.object({ params: z.object({ partnerId: uuid }), body: partnerBody }),

  getTerms: z.object({ params: z.object({ tenantId: uuid }) }),
  saveTerms: z.object({
    params: z.object({ tenantId: uuid }),
    body: z.object({ marginPercent: percent, truckerAdvancePercent: percent }).strict(),
  }),

  approve: z.object({
    params: sourcingParams,
    body: z
      .object({
        marginPercent: percent.optional(),
        truckerAdvancePercent: percent.optional(),
        acknowledgeMissing: z.boolean().optional(),
      })
      .strict(),
  }),
  reject: z.object({
    params: sourcingParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  }),

  partnerBid: z.object({
    params: sourcingParams,
    body: z
      .object({
        partnerId: uuid,
        rate: z.number().positive(),
        vehicleNumber: z.string().trim().min(4).max(20).optional(),
      })
      .strict(),
  }),
  sendBid: z.object({
    params: sourcingParams,
    body: z
      .object({
        partnerBidId: uuid,
        shipperPrice: z.number().positive().optional(),
        negotiationNote: z.string().trim().min(3).max(500).optional(),
      })
      .strict(),
  }),

  nameDriver: z.object({
    params: loadParams,
    body: z
      .object({
        driverName: z.string().trim().min(1).max(150),
        driverMobile: mobile,
        licenceNumber: z.string().trim().min(5).max(30),
        dateOfBirth: isoDateSchema,
        licenceFrontFileKey: z.string().trim().min(1),
        licenceBackFileKey: z.string().trim().min(1),
        rcCopyFileKey: z.string().trim().min(1),
      })
      .strict(),
  }),
  approveVerification: z.object({
    params: loadParams,
    body: z
      .object({
        loadingContactName: z.string().trim().min(1).max(150).optional(),
        loadingContactPhone: mobile.optional(),
      })
      .strict(),
  }),

  markStage: z.object({
    params: loadParams,
    body: z.object({ toStatus: z.enum(MANUAL_TRACKING_STATUSES) }).strict(),
  }),
  uploadPapers: z.object({ params: loadParams, body: confirmLoadingBody }),
  approvePapers: z.object({
    params: loadParams,
    body: z.object({ ewayBillNamesLoadsmart: z.boolean() }).strict(),
  }),
  raiseCharge: z.object({
    params: loadParams,
    body: z
      .object({
        chargeType: z.enum(CHARGE_TYPES),
        amount: z.number().positive(),
        note: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),
  partnerPayment: z.object({ params: loadParams, body: utr }),

  reviewPod: z.object({
    params: loadParams,
    body: z
      .object({
        decision: z.enum(POD_REVIEW_DECISIONS),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  settleClaim: z.object({
    params: loadParams,
    body: z.object({ partnerRecovery: money, note: z.string().trim().min(3).max(1000) }).strict(),
  }),
  rate: z.object({
    params: loadParams,
    body: z
      .object({
        shipperScore: z.number().int().min(1).max(5),
        partnerScore: z.number().int().min(1).max(5),
        note: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),
  originalPod: z.object({
    params: loadParams,
    body: z
      .object({
        courierName: z.string().trim().min(1).max(150).optional(),
        trackingNumber: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
  }),
  invoice: z.object({
    params: loadParams,
    body: z
      .object({
        gstPercent: percent.optional(),
        dueDays: z.number().int().min(0).max(120).optional(),
      })
      .strict(),
  }),
  decidePayment: z.object({
    params: z.object({ loadId: uuid, paymentId: uuid }),
    body: z
      .object({
        decision: z.enum(['verified', 'rejected']),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),

  // --- Shipper side, on /v1/loads ---
  decideCharge: z.object({
    params: z.object({ loadId: uuid, chargeId: uuid }),
    body: z
      .object({
        decision: z.enum(['approved', 'rejected']),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  unloadingCharge: z.object({
    params: loadParams,
    body: z
      .object({ amount: z.number().positive(), note: z.string().trim().max(500).optional() })
      .strict(),
  }),
  unloadingContact: z.object({
    params: loadParams,
    body: z.object({ name: z.string().trim().min(1).max(150), phone: mobile }).strict(),
  }),
  claimValue: z.object({
    params: loadParams,
    body: z.object({ claimValue: money, note: z.string().trim().max(500).optional() }).strict(),
  }),
};
