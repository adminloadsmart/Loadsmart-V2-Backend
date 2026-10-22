import { GST_RECORD_STATUSES } from '../gst/gst.types';

/**
 * Transporter-side value sets. Declared once here as a `const` tuple so the entity's
 * `@Column({ enum: [...] })` and the request schema in masters.validators.ts can never drift
 * apart — see drivers.types.ts for the same pattern.
 */

/** PRD §5.4.2 (FMS-MAS-TRN-001) — dropdown options for the transporter's company type. */
export const TRANSPORTER_COMPANY_TYPES = [
  'proprietorship',
  'partnership',
  'private_limited',
  'public_limited',
  'llp',
  'huf',
  'others',
] as const;
export type TransporterCompanyType = (typeof TRANSPORTER_COMPANY_TYPES)[number];

/** Transporter creation is org_admin-only (unlike customers/drivers), so there's no pending-
 *  approval state to model here — just a simple active/inactive toggle. */
export const TRANSPORTER_STATUSES = ['active', 'inactive'] as const;
export type TransporterStatus = (typeof TRANSPORTER_STATUSES)[number];

/** Add Transporter → "GST Treatment": forward charge (registered GTA charging GST) or reverse
 *  charge (the shipper pays GST under RCM). */
export const TRANSPORTER_GST_TREATMENTS = ['forward_charge', 'reverse_charge'] as const;
export type TransporterGstTreatment = (typeof TRANSPORTER_GST_TREATMENTS)[number];

/** Penny-drop result for the settlement account — same vocabulary as driver_bank_details
 *  (IdfyClient.verifyBankAccount / toBankVerificationColumns). */
export const TRANSPORTER_BANK_VERIFICATION_STATUSES = ['verified', 'rejected', 'pending'] as const;
export type TransporterBankVerificationStatus =
  (typeof TRANSPORTER_BANK_VERIFICATION_STATUSES)[number];

/** "Shared master" (verified against the GST register) vs "Own record" (typed in, unverified). */
export type MasterRecordSource = 'shared_master' | 'own_record';

/** The shared verified/unverified pair plus the bulk-import queue's states: 'pending' while the
 *  'gst-verification' job waits, 'failed' when the register rejected it or retries ran out. */
export const TRANSPORTER_GST_STATUSES = [...GST_RECORD_STATUSES, 'pending', 'failed'] as const;
export type TransporterGstStatus = (typeof TRANSPORTER_GST_STATUSES)[number];
