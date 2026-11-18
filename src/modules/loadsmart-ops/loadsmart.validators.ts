import { z } from 'zod';
import { isoDateSchema } from '../../shared/utils/date';
import {
  CHARGE_TYPES,
  ON_BEHALF_CHANNELS,
  CLAIM_RECOVERY_MODES,
  INVOICE_SEND_CHANNELS,
  ORIGINAL_POD_STATUSES,
  PARTNER_PAYMENT_STATUSES,
  PAYMENT_MODES_IN,
  POD_TYPES,
  RECEIPT_CHANNELS,
  SHORTFALL_REASONS,
  UNCLAIMED_STATUSES,
  PARTNER_STATUSES,
  PARTNER_TYPES,
  CALL_CONTACTS,
  CALL_OUTCOMES,
  ETA_TARGETS,
} from './loadsmart.types';
import { reviewDocumentBody } from '../loads/documents/load-document.validators';
import { elrIssueBody, reviewPodBody, unloadingDetailsBody } from '../loads/core/load.validators';
import { ELR_EDIT_REASONS } from '../loads/elr/load-elr-revision.entity';
import { booleanString } from '../../shared/validators/boolean-string';
import { TRANSPORTER_CHARGE_HEADS } from '../loads/money/charge.types';
import { TRUCK_BODY_TYPES } from '../masters/truck-type/truck-type.types';
import { CONSOLE_TEAMS, LIVE_STATUSES } from './console-rules';
import { LOAD_STATUSES } from '../loads/utils/loads.types';
import { MSME_CREDIT_DAYS_CAP } from '../settings/settings.types';
import {
  manualDriverCheckBody,
  manualTruckCheckBody,
} from '../loads/sourcing/load-sourcing.validators';
import { postLoadBody } from '../loads/load-posting/load-posting.validators';

const uuid = z.string().uuid();
const loadParams = z.object({ loadId: uuid });
const sourcingParams = z.object({ sourcingId: uuid });
const mobile = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Must be a 10-digit mobile number');
const percent = z.number().min(0).max(100);
const money = z.number().nonnegative();
/** Paying a carrier: the UTR, the payment advice, or both — at least one. */
const partnerPay = z
  .object({
    utrReference: z.string().trim().min(1).max(100).optional(),
    proofFileKey: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((body) => body.utrReference || body.proofFileKey, {
    message: 'Give the UTR or upload the payment advice',
    path: ['utrReference'],
  });

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
    body: z
      .object({
        marginPercent: percent.optional(),
        truckerAdvancePercent: percent,
        // "Preapproved loading and unloading charges" — approved as Loadsmart raises them.
        preapprovedCharges: z
          .array(
            z
              .object({
                head: z.enum(TRANSPORTER_CHARGE_HEADS),
                maxAmount: money.nullable().optional(),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        // Billing: credit days from invoice receipt, POD type, billing instructions.
        creditDays: z.number().int().min(0).max(MSME_CREDIT_DAYS_CAP).nullable().optional(),
        podType: z.enum(POD_TYPES).optional(),
        billingInstructions: z
          .array(
            z.object({ head: z.enum(TRANSPORTER_CHARGE_HEADS), notBilledUnder: money }).strict(),
          )
          .max(20)
          .optional(),
        billingNote: z.string().trim().max(1000).nullable().optional(),
      })
      .strict(),
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

  addCharge: z.object({
    params: loadParams,
    body: z
      .object({
        chargeType: z.enum(CHARGE_TYPES),
        amount: z.number().positive(),
        note: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),
  partnerPayment: z.object({ params: loadParams, body: partnerPay }),

  // --- Tracking: charges, e-LR, the carrier advance ---
  raiseCharge: z.object({
    params: loadParams,
    body: z
      .object({
        head: z.enum(TRANSPORTER_CHARGE_HEADS),
        amount: z.number().positive().max(100_000_000),
        remark: z.string().trim().min(1).max(500).optional(),
        proofFileKey: z.string().trim().min(1).optional(),
      })
      .strict(),
  }),
  chargeAdminDecision: z.object({
    params: z.object({ loadId: uuid, chargeId: uuid }),
    body: z
      .object({
        decision: z.enum(['approved', 'rejected']),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  raiseAdvance: z.object({
    params: loadParams,
    body: z
      .object({ chargeIds: z.array(uuid).min(1).max(20).optional() })
      .strict()
      .default({}),
  }),
  replyToChargeQuery: z.object({
    params: z.object({ loadId: uuid, chargeId: uuid }),
    body: z.object({ reply: z.string().trim().min(1).max(1000) }).strict(),
  }),
  issueElr: z.object({ params: loadParams, body: elrIssueBody }),
  editElr: z.object({
    params: loadParams,
    body: z
      .object({
        reason: z.enum(ELR_EDIT_REASONS),
        note: z.string().trim().max(500).optional(),
        packages: z.number().int().positive().optional(),
        sealNumber: z.string().trim().min(1).max(50).optional(),
        showFreight: z.boolean().optional(),
        driverName: z.string().trim().min(1).max(150).optional(),
        driverMobile: mobile.optional(),
      })
      .strict(),
  }),
  cancelElr: z.object({
    params: loadParams,
    body: z.object({ note: z.string().trim().min(3).max(500) }).strict(),
  }),
  partnerPayments: z.object({
    query: z
      .object({
        status: z
          .union([z.enum(PARTNER_PAYMENT_STATUSES), z.array(z.enum(PARTNER_PAYMENT_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
      })
      .strict(),
  }),
  decidePartnerPayment: z.object({
    params: z.object({ paymentId: uuid }),
    body: z
      .object({
        decision: z.enum(['approved', 'on_hold', 'rejected']),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
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
  rerunChecks: z.object({ params: loadParams }),
  verifyTruckManually: z.object({ params: loadParams, body: manualTruckCheckBody }),
  verifyDriverManually: z.object({ params: loadParams, body: manualDriverCheckBody }),

  // --- Placement ---
  partnerClaims: z.object({
    params: z.object({ partnerId: uuid }),
    body: z
      .object({
        lanes: z
          .array(
            z
              .object({
                fromCity: z.string().trim().min(1).max(100),
                toCity: z.string().trim().min(1).max(100),
              })
              .strict(),
          )
          .max(100),
        truckTypes: z
          .array(
            z
              .object({
                bodyType: z.enum(TRUCK_BODY_TYPES),
                capacityTons: z.number().positive().max(100).optional(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
  }),
  partnerProfile: z.object({
    params: z.object({ partnerId: uuid }),
    body: z
      .object({
        advancePercent: z.number().min(50).max(100).nullable().optional(),
        noteForPlacement: z.string().trim().max(1000).nullable().optional(),
        truckerSalesName: z.string().trim().max(150).nullable().optional(),
        truckerSalesPhone: mobile.nullable().optional(),
      })
      .strict(),
  }),
  matchBrokers: z.object({ params: sourcingParams }),
  placementInbox: z.object({
    query: z.object({ mine: booleanString.optional(), tenantId: uuid.optional() }),
  }),
  saveRoster: z.object({
    body: z
      .object({
        members: z
          .array(
            z
              .object({
                userId: uuid,
                onDuty: z.boolean(),
                turnOrder: z.number().int().min(0).max(1000),
              })
              .strict(),
          )
          .max(200),
      })
      .strict(),
  }),
  moveOwnerParams: z.object({ params: sourcingParams }),
  moveOwner: z.object({
    params: sourcingParams,
    // `team` says whose owner moves: Placement's (the default) or Tracking's.
    body: z
      .object({ ownerId: uuid, team: z.enum(['placement', 'tracking']).default('placement') })
      .strict(),
  }),
  markLost: z.object({
    params: sourcingParams,
    body: z
      .object({
        reasonCode: z.string().trim().min(2).max(50),
        note: z.string().trim().min(1).max(500).optional(),
        shipperRate: money.optional(),
        brokerRate: money.optional(),
      })
      .strict(),
  }),
  withdrawMemo: z.object({
    params: loadParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  }),

  // --- Approval: post a load for a shipper ---
  postForShipper: z.object({
    params: z.object({ tenantId: uuid }),
    body: z
      .object({
        posting: postLoadBody,
        request: z
          .object({
            channel: z.enum(ON_BEHALF_CHANNELS),
            requestedBy: z.string().trim().min(1).max(150),
            proofFileKey: z.string().trim().min(1).optional(),
          })
          .strict(),
      })
      .strict(),
  }),
  confirmMemo: z.object({
    params: loadParams,
    body: z
      .object({
        loadingContactName: z.string().trim().min(1).max(150).optional(),
        loadingContactPhone: mobile.optional(),
        loadingPointNote: z.string().trim().min(1).max(300).optional(),
      })
      .strict(),
  }),
  listDocuments: z.object({
    params: loadParams,
    query: z.object({ history: booleanString.optional() }),
  }),
  reviewDocument: z.object({
    params: loadParams.extend({ documentId: uuid }),
    body: reviewDocumentBody,
  }),
  /** Tracking decides the POD on a Loadsmart load — same body as the shipper's review. */
  decidePod: z.object({ params: loadParams, body: reviewPodBody }),
  // --- Customer support: claims ---
  claimsInbox: z.object({ query: z.object({ mine: booleanString.optional() }).strict() }),
  assignClaim: z.object({ params: loadParams, body: z.object({ agentId: uuid }).strict() }),
  updateClaim: z.object({
    params: loadParams,
    body: z
      .object({
        csAssessment: money.optional(),
        agreedAmount: money.optional(),
        recoveryMode: z.enum(CLAIM_RECOVERY_MODES).optional(),
        carrierAmount: money.optional(),
        shipperDebitNoteRef: z.string().trim().min(1).max(100).optional(),
        evidenceFileKeys: z.array(z.string().trim().min(1)).max(20).optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .strict(),
  }),
  closeClaim: z.object({
    params: loadParams,
    body: z.object({ note: z.string().trim().min(3).max(1000) }).strict(),
  }),

  // --- Receivables ---
  invoice: z.object({ params: z.object({ invoiceId: uuid }) }),
  invoiceDelivery: z.object({
    params: z.object({ invoiceId: uuid }),
    body: z
      .object({
        via: z.enum(INVOICE_SEND_CHANNELS).optional(),
        receivedOn: isoDateSchema.optional(),
      })
      .strict(),
  }),
  recordReceipt: z.object({
    params: z.object({ invoiceId: uuid }),
    body: z
      .object({
        amount: z.number().positive().max(1_000_000_000),
        receivedOn: isoDateSchema,
        paidThrough: z.enum(RECEIPT_CHANNELS),
        utrReference: z.string().trim().min(1).max(100).optional(),
        tdsCut: money.optional(),
        shortfallReason: z.enum(SHORTFALL_REASONS).optional(),
        shortfallNote: z.string().trim().max(500).optional(),
        loadPaymentId: uuid.optional(),
      })
      .strict(),
  }),
  listUnclaimed: z.object({
    query: z
      .object({
        status: z
          .union([z.enum(UNCLAIMED_STATUSES), z.array(z.enum(UNCLAIMED_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
      })
      .strict(),
  }),
  addUnclaimed: z.object({
    body: z
      .object({
        amount: z.number().positive().max(1_000_000_000),
        payerName: z.string().trim().min(1).max(150),
        mode: z.enum(PAYMENT_MODES_IN),
        utrReference: z.string().trim().min(1).max(100).optional(),
        remitterBank: z.string().trim().min(1).max(150).optional(),
        receivedOn: isoDateSchema,
        remark: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  updateUnclaimed: z.object({
    params: z.object({ paymentId: uuid }),
    body: z
      .object({
        status: z.enum(['under_review', 'refunded']).optional(),
        remark: z.string().trim().min(1).max(500),
      })
      .strict(),
  }),
  matchUnclaimed: z.object({
    params: z.object({ paymentId: uuid }),
    body: z
      .object({
        invoiceId: uuid,
        paidThrough: z.enum(RECEIPT_CHANNELS),
        tdsCut: money.optional(),
        remark: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),

  // --- Payables: original POD tracker ---
  originalPods: z.object({
    query: z
      .object({
        status: z
          .union([z.enum(ORIGINAL_POD_STATUSES), z.array(z.enum(ORIGINAL_POD_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
        pastDue: booleanString.optional(),
        shipperNeedsOriginal: booleanString.optional(),
      })
      .strict(),
  }),
  updateOriginalPod: z.object({
    params: loadParams,
    body: z
      .object({
        status: z.enum(ORIGINAL_POD_STATUSES).optional(),
        courierName: z.string().trim().min(1).max(100).optional(),
        docketNumber: z.string().trim().min(1).max(100).optional(),
        holder: z.string().trim().min(1).max(150).optional(),
      })
      .strict(),
  }),
  originalPodCall: z.object({
    params: loadParams,
    body: z
      .object({
        outcome: z.string().trim().min(1).max(100),
        note: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),

  // Super Admin on a shipper's cancellation of a Loadsmart load (a reason to reject).
  decideCancellation: z.object({
    params: z.object({ cancellationId: uuid }),
    body: z
      .object({
        decision: z.enum(['approved', 'rejected']),
        note: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),

  answerShipperCounter: z.object({
    params: z.object({ loadId: uuid, bidId: uuid }),
    body: z
      .object({
        accepted: z.boolean(),
        // Required when the counter leaves less than the minimum margin.
        negotiationNote: z.string().trim().min(1).max(1000).optional(),
      })
      .strict(),
  }),

  // --- The member's own inbox ---
  notifications: z.object({
    query: z
      .object({
        unreadOnly: booleanString.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
  }),
  notification: z.object({ params: z.object({ notificationId: uuid }) }),

  // --- Cross-team views ---
  allLoads: z.object({
    query: z
      .object({
        status: z
          .union([z.enum(LOAD_STATUSES), z.array(z.enum(LOAD_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
        tenantId: uuid.optional(),
        team: z.enum(CONSOLE_TEAMS).optional(),
        q: z.string().trim().min(2).max(50).optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
  }),
  uploadPapers: z.object({
    params: loadParams,
    body: z
      .object({
        invoiceNumber: z.string().trim().min(1).max(50).optional(),
        invoiceFileKey: z.string().trim().min(1).optional(),
        ewayBillNumber: z.string().trim().min(1).max(50).optional(),
        ewayBillFileKey: z.string().trim().min(1).optional(),
        ewayBillExpiresAt: z.coerce.date().optional(),
        elrNumber: z.string().trim().min(1).max(50).optional(),
        elrFileKey: z.string().trim().min(1).optional(),
      })
      .strict()
      .refine((b) => (b.invoiceNumber === undefined) === (b.invoiceFileKey === undefined), {
        message: 'invoiceNumber and invoiceFileKey must be submitted together',
        path: ['invoiceNumber'],
      })
      .refine((b) => (b.ewayBillNumber === undefined) === (b.ewayBillFileKey === undefined), {
        message: 'ewayBillNumber and ewayBillFileKey must be submitted together',
        path: ['ewayBillNumber'],
      })
      .refine((b) => b.ewayBillExpiresAt === undefined || b.ewayBillFileKey !== undefined, {
        message: 'ewayBillExpiresAt needs the e-way bill',
        path: ['ewayBillExpiresAt'],
      })
      .refine((b) => b.elrNumber === undefined || b.elrFileKey !== undefined, {
        message: 'elrNumber needs elrFileKey',
        path: ['elrNumber'],
      })
      .refine((b) => b.invoiceFileKey || b.ewayBillFileKey || b.elrFileKey, {
        message: 'Attach at least one paper',
      }),
  }),
  uploadPod: z.object({
    params: loadParams,
    body: z
      .object({
        podFileKey: z.string().trim().min(1),
        podBackFileKey: z.string().trim().min(1).optional(),
        outcome: z.enum(['delivered_ok', 'delivered_with_issues']),
        issueType: z.enum(['damage', 'shortage', 'pilferage']).optional(),
        remark: z.string().trim().min(1).max(1000).optional(),
        receiverName: z.string().trim().min(1).max(150).optional(),
        quantityReceived: z.number().positive().max(1000).optional(),
        numberOfTonnesShort: z.number().min(0).max(1000).optional(),
      })
      .strict()
      .refine((b) => b.outcome !== 'delivered_with_issues' || (b.issueType && b.remark), {
        message: 'Give the issue type and a remark when delivered with issues',
        path: ['issueType'],
      })
      .refine((b) => b.outcome === 'delivered_with_issues' || !b.issueType, {
        message: 'An issue type goes with "delivered with issues"',
        path: ['issueType'],
      }),
  }),
  documentsPage: z.object({
    query: z
      .object({
        q: z.string().trim().min(2).max(50).optional(),
        series: z.string().trim().min(1).max(20).optional(),
        docType: z.string().trim().min(1).max(30).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        includeHistory: booleanString.optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
  }),
  logCall: z.object({
    params: loadParams,
    body: z
      .object({
        contact: z.enum(CALL_CONTACTS),
        phone: z.string().trim().min(5).max(20).optional(),
        outcome: z.enum(CALL_OUTCOMES),
        note: z.string().trim().min(1).max(1000).optional(),
        locationLabel: z.string().trim().min(1).max(200).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        etaAt: z.coerce.date().optional(),
        etaTarget: z.enum(ETA_TARGETS).optional(),
      })
      .strict()
      .refine((body) => (body.latitude === undefined) === (body.longitude === undefined), {
        message: 'Give both latitude and longitude',
        path: ['longitude'],
      })
      .refine((body) => !body.etaTarget || body.etaAt, {
        message: 'etaTarget needs etaAt',
        path: ['etaAt'],
      }),
  }),
  listCalls: z.object({
    params: loadParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict(),
  }),
  trackingInbox: z.object({
    query: z
      .object({
        status: z
          .union([z.enum(LOAD_STATUSES), z.array(z.enum(LOAD_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
        mine: booleanString.optional(),
        unclaimed: booleanString.optional(),
        q: z.string().trim().min(2).max(50).optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
  }),
  analytics: z.object({
    query: z
      .object({ from: z.coerce.date(), to: z.coerce.date() })
      .strict()
      .refine((query) => query.from < query.to, { message: 'from must be before to', path: ['to'] })
      .refine((query) => query.to.getTime() - query.from.getTime() <= 366 * 24 * 60 * 60 * 1000, {
        message: 'At most a year at a time',
        path: ['to'],
      }),
  }),
  liveMap: z.object({
    query: z
      .object({
        q: z.string().trim().min(2).max(50).optional(),
        status: z
          .union([z.enum(LIVE_STATUSES), z.array(z.enum(LIVE_STATUSES))])
          .transform((value) => (Array.isArray(value) ? value : [value]))
          .optional(),
      })
      .strict(),
  }),

  // --- Shipper side, on /v1/loads ---
  decideCharge: z.object({
    params: z.object({ loadId: uuid, chargeId: uuid }),
    body: z
      .object({
        decision: z.enum(['approved', 'rejected', 'queried']),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  decideCharges: z.object({
    params: loadParams,
    body: z
      .object({
        decisions: z
          .array(
            z
              .object({
                chargeId: uuid,
                decision: z.enum(['approved', 'rejected', 'queried']),
                reason: z.string().trim().min(1).max(500).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
  }),
  unloadingDetails: z.object({ params: loadParams, body: unloadingDetailsBody }),
  claimValue: z.object({
    params: loadParams,
    body: z.object({ claimValue: money, note: z.string().trim().max(500).optional() }).strict(),
  }),
};
