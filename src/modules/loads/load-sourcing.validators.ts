import { z } from 'zod';

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
      })
      .strict(),
  }),

  getMemo: z.object({ params }),
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
