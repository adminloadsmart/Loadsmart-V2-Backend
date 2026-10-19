/** Outcome of one GSTIN lookup. `unavailable` = no verdict (IDfy unconfigured, failed, timed out),
 *  which the Add Customer / Add Transporter drawer shows as "Unverified GSTIN · Retry now". */
export const GST_VERIFICATION_RESULTS = [
  'verified',
  'not_found',
  'inactive',
  'unavailable',
] as const;
export type GstVerificationResult = (typeof GST_VERIFICATION_RESULTS)[number];

/** Stored on customers/transporters: 'verified' only when backed by a verified lookup row. */
export const GST_RECORD_STATUSES = ['verified', 'unverified'] as const;
export type GstRecordStatus = (typeof GST_RECORD_STATUSES)[number];

/** A verified lookup can be attached to a customer/transporter save for this long. */
export const GST_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface GstAddressParts {
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  state: string;
  pinCode: string;
}

export interface VerifyGstInput {
  gstin: string;
  legalName?: string;
}
