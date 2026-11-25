import { z } from 'zod';
import { isoDateSchema } from '../../../shared/utils/date';
import { TRUCK_CANCELLATION_NEXT_STEPS } from '../entities/load-cancellation.entity';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });
const bidParams = z.object({ loadId: uuid, bidId: uuid });
const vehicleNumber = z.string().trim().min(4).max(20);
const mobile = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Must be a 10-digit mobile number');

/** Bids, indent acceptance, driver and load memo — see bids/ and memo/. */
/** An admin's manual truck check while VAHAN is down: the RC checkbox, and any paper expiry dates
 *  read off the papers (an expired one still fails the check). */
export const manualTruckCheckBody = z
  .object({
    rcChecked: z.literal(true),
    papers: z
      .object({
        rcValidTo: isoDateSchema,
        fitnessValidTo: isoDateSchema,
        insuranceValidTo: isoDateSchema,
        pucValidTo: isoDateSchema,
        permitValidTo: isoDateSchema,
      })
      .partial()
      .strict()
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** An admin's manual licence check while Sarathi can't confirm it: the licence checkbox, and its
 *  validity date if read off the card (an expired one still fails the check). */
export const manualDriverCheckBody = z
  .object({
    licenceChecked: z.literal(true),
    validUntil: isoDateSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const loadSourcingValidators = {
  listBids: z.object({ params }),

  // "Extend": the bid window restarts at 4 hours from now — no body.
  extendBidWindow: z.object({ params }),

  // A rate one of the shipper's transporters gave by phone — reason is required and logged.
  recordBid: z.object({
    params,
    body: z
      .object({
        transporterId: uuid,
        rate: z.number().positive(),
        vehicleNumber: vehicleNumber.optional(),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict(),
  }),

  setBidTruck: z.object({
    params: bidParams,
    body: z.object({ vehicleNumber }).strict(),
  }),

  acceptBid: z.object({ params: bidParams }),
  // Counter a live bid; record the bidder's answer; reject a bid.
  counterBid: z.object({
    params: bidParams,
    body: z
      .object({
        rate: z.number().positive().max(100_000_000),
        note: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  answerCounter: z.object({
    params: bidParams,
    body: z.object({ accepted: z.boolean() }).strict(),
  }),
  rejectBid: z.object({
    params: bidParams,
    body: z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict(),
  }),

  // An indent transporter rejected it (by phone) — the load goes to the open market once no
  // other indent transporter can take it.
  recordIndentRejection: z.object({
    params,
    body: z
      .object({
        transporterId: uuid,
        reason: z.string().trim().min(3).max(500),
      })
      .strict(),
  }),

  rerunChecks: z.object({ params }),
  verifyTruckManually: z.object({ params, body: manualTruckCheckBody }),
  verifyDriverManually: z.object({ params, body: manualDriverCheckBody }),

  // Truck cancelled between Truck assigned and Loaded — a reason code from Settings.
  cancelTruck: z.object({
    params,
    body: z
      .object({
        reasonCode: z.string().trim().min(2).max(50),
        note: z.string().trim().min(1).max(500).optional(),
        next: z.enum(TRUCK_CANCELLATION_NEXT_STEPS),
      })
      .strict(),
  }),
  listTruckCancellations: z.object({ params }),
  // Withdraw the load — until the load memo is accepted. Reason code defaults to shipper_cancelled.
  withdrawLoad: z.object({
    params,
    body: z
      .object({
        reasonCode: z.string().trim().min(2).max(50).optional(),
        note: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  // Cancel the whole load, before Loaded.
  cancelLoad: z.object({
    params,
    body: z
      .object({
        reasonCode: z.string().trim().min(2).max(50),
        note: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  }),
  listMemos: z.object({ params }),

  // "Transporter accepted": an indent transporter said yes by phone — entered on their behalf,
  // 30 minutes after the request went out. The truck number awards the indent to them; it can
  // follow later (here again, or with the driver).
  recordIndentAcceptance: z.object({
    params,
    body: z
      .object({
        transporterId: uuid,
        vehicleNumber: vehicleNumber.optional(),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict(),
  }),

  nameDriver: z.object({
    params,
    body: z
      .object({
        driverName: z.string().trim().min(1).max(150),
        driverMobile: mobile,
        // Checked on Sarathi with the date of birth before the memo goes out.
        licenceNumber: z.string().trim().min(5).max(30),
        dateOfBirth: isoDateSchema,
        // The truck number, if it wasn't sent with the bid or the truck was cancelled. Required
        // on an indent still waiting for its truck.
        vehicleNumber: vehicleNumber.optional(),
        // Why the shipper is entering details the transporter gave outside WhatsApp.
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict(),
  }),

  getMemo: z.object({ params }),
  getChecks: z.object({ params }),
  resendMemo: z.object({ params }),

  acceptMemo: z.object({
    params,
    body: z
      .object({
        loadingContactName: z.string().trim().min(1).max(150).optional(),
        loadingContactPhone: mobile.optional(),
        loadingPointNote: z.string().trim().min(1).max(300).optional(),
      })
      .strict(),
  }),
};
