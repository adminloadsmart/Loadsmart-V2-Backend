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
export const loadSourcingValidators = {
  listBids: z.object({ params }),

  // A rate one of the shipper's transporters gave by phone — reason is required and logged.
  recordBid: z.object({
    params,
    body: z
      .object({
        transporterId: uuid,
        rate: z.number().positive(),
        vehicleNumber: vehicleNumber.optional(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict(),
  }),

  setBidTruck: z.object({
    params: bidParams,
    body: z.object({ vehicleNumber }).strict(),
  }),

  acceptBid: z.object({ params: bidParams }),

  // The contracted transporter rejected the indent — the load goes to the open market.
  recordIndentRejection: z.object({
    params,
    body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  }),

  rerunChecks: z.object({ params }),

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
  listMemos: z.object({ params }),

  // The contracted transporter accepts the indent and sends the truck number.
  recordIndentAcceptance: z.object({
    params,
    body: z.object({ vehicleNumber }).strict(),
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
        // The truck number, if it wasn't sent with the bid or the truck was cancelled.
        vehicleNumber: vehicleNumber.optional(),
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
