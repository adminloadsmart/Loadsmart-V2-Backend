import { z } from 'zod';

/**
 * Super Admin → Settings (S03): the platform-wide timers, thresholds and money defaults the Load
 * module runs on. Nothing here is hard-coded at the call sites — every rule reads the values the
 * load was posted under (loads.settings_version_id), so a save only affects loads posted after it.
 *
 * Tracking thresholds (arrival wait, geofence radius, trip-started distance, halt, detention) are
 * owned by the tracking service, and bid, messaging and notification timings are not in this
 * build, so none of those are kept here.
 */

const DAY_MINUTES = 24 * 60;
/** "Balance-due days … capped at 45 days since Loadsmart is MSME-registered." */
export const MSME_CREDIT_DAYS_CAP = 45;
const minutes = (min: number, max: number) => z.number().int().min(min).max(max);

/** "Reason codes: bid other than L1, load lost, carrier not interested, no vehicle, truck cancelled
 *  by carrier, shipper cancelled, document rejected, driver DL failed check." */
export const DEFAULT_REASON_CODES = [
  { code: 'bid_other_than_l1', label: 'Bid other than L1' },
  { code: 'load_lost', label: 'Load lost' },
  { code: 'carrier_not_interested', label: 'Carrier not interested' },
  { code: 'no_vehicle', label: 'No vehicle' },
  { code: 'truck_cancelled_by_carrier', label: 'Truck cancelled by carrier' },
  { code: 'shipper_cancelled', label: 'Shipper cancelled' },
  { code: 'document_rejected', label: 'Document rejected' },
  { code: 'driver_dl_failed_check', label: 'Driver DL failed check' },
].map((reason) => ({ ...reason, active: true }));

const reasonCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,50}$/, 'Use lowercase letters, digits and underscores'),
    label: z.string().trim().min(1).max(100),
    active: z.boolean(),
  })
  .strict();

const settingsShape = {
  /** Expected price → market price, and bid → shipper price on Ask for quotes. */
  centralMarginPercent: z.number().min(0).max(50),
  /** The lowest margin a negotiated rate may leave — a hard stop; may be negative. */
  marginFloorPercent: z.number().min(-50).max(50),
  /** Truck reporting time must be at least this long after posting. */
  minReportingLeadMinutes: minutes(0, 7 * DAY_MINUTES),
  /** The load memo expires this long after it is sent. */
  memoExpiryMinutes: minutes(5, DAY_MINUTES),
  /** Broker advance as a % of carrier freight (85% or 80% per carrier needs Super Admin). */
  defaultCarrierAdvancePercent: z.number().min(0).max(100),
  /** Original POD due this many days after delivery … */
  originalPodDueDays: z.number().int().min(1).max(90),
  /** … then this much a day comes off the carrier's balance. */
  originalPodPenaltyPerDay: z.number().min(0).max(100_000),
  /** Shipper credit: per shipper from onboarding, never more than 45 days (Loadsmart is
   *  MSME-registered — the Figma review, replacing the spec's "at most 10"). */
  defaultShipperCreditDays: z.number().int().min(0).max(MSME_CREDIT_DAYS_CAP),
  maxShipperCreditDays: z.number().int().min(0).max(MSME_CREDIT_DAYS_CAP),
  /** Loadsmart's bank account shippers pay invoices into (Pay invoice). Null until Super Admin
   *  fills it in. */
  loadsmartPayee: z
    .object({
      legalName: z.string().trim().min(1).max(200).nullable(),
      bankName: z.string().trim().min(1).max(150).nullable(),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{6,20}$/, '6–20 digits')
        .nullable(),
      ifsc: z
        .string()
        .trim()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An 11-character IFSC')
        .nullable(),
      upiId: z.string().trim().min(3).max(100).nullable(),
    })
    .strict(),
  /** Loadsmart's invoice: GST on transport (GTA) — under reverse charge the shipper pays it. */
  gstPercent: z.number().min(0).max(28),
  gstReverseCharge: z.boolean(),
  /** The state of Loadsmart's GSTIN (two digits) — the shipper in it gets CGST + SGST, anyone
   *  else IGST. */
  loadsmartGstStateCode: z.string().regex(/^\d{2}$/, 'Two digits, as on the GSTIN'),
  /** Receivables' target: invoice within this many days of delivery, then it is flagged late. */
  invoiceTargetDays: z.number().int().min(0).max(30),
  /** Lost loads and rejections. */
  reasonCodes: z.array(reasonCodeSchema).min(1).max(100),
};

function checkConsistency(
  value: {
    centralMarginPercent: number;
    marginFloorPercent: number;
    defaultShipperCreditDays: number;
    maxShipperCreditDays: number;
    reasonCodes: { code: string }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (value.marginFloorPercent > value.centralMarginPercent) {
    ctx.addIssue({
      code: 'custom',
      path: ['marginFloorPercent'],
      message: 'The margin floor cannot be above the central margin',
    });
  }
  if (value.defaultShipperCreditDays > value.maxShipperCreditDays) {
    ctx.addIssue({
      code: 'custom',
      path: ['defaultShipperCreditDays'],
      message: 'The default credit days cannot be above the maximum',
    });
  }
  const codes = value.reasonCodes.map((reason) => reason.code);
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: 'custom', path: ['reasonCodes'], message: 'Reason codes must be unique' });
  }
}

/** What Super Admin saves — every field, nothing unknown. */
export const settingsInputSchema = z.object(settingsShape).strict().superRefine(checkConsistency);

export type SettingsValues = z.infer<typeof settingsInputSchema>;

/** "Value today" column of the spec's settings table. Version 1 (migration) stores exactly this. */
export const DEFAULT_SETTINGS: SettingsValues = {
  centralMarginPercent: 5,
  marginFloorPercent: 2,
  minReportingLeadMinutes: 30,
  memoExpiryMinutes: 60,
  defaultCarrierAdvancePercent: 90,
  originalPodDueDays: 15,
  originalPodPenaltyPerDay: 100,
  defaultShipperCreditDays: 3,
  maxShipperCreditDays: MSME_CREDIT_DAYS_CAP,
  loadsmartPayee: { legalName: null, bankName: null, accountNumber: null, ifsc: null, upiId: null },
  gstPercent: 5,
  gstReverseCharge: true,
  loadsmartGstStateCode: '03',
  invoiceTargetDays: 1,
  reasonCodes: DEFAULT_REASON_CODES,
};

/** A stored version, read back. Settings added after a version was saved take today's default,
 *  and keys since removed are dropped — old versions never fail to load. */
export function parseStoredSettings(stored: unknown): SettingsValues {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored && typeof stored === 'object' ? stored : {}),
  };
  return z.object(settingsShape).superRefine(checkConsistency).parse(merged);
}

/** A settings version as the rules use it. `id` is null only before version 1 exists. */
export interface ResolvedSettings {
  id: string | null;
  version: number;
  values: SettingsValues;
}

/** What the Load module needs from settings — implemented by SettingsService. */
export interface SettingsReader {
  /** The latest saved version — for a load being posted now. */
  current(): Promise<ResolvedSettings>;
  /** The version the load was posted under (the latest one if it has none). */
  forLoad(load: { settingsVersionId: string | null }): Promise<ResolvedSettings>;
}
