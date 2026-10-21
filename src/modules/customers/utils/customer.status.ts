import { GST_RECORD_STATUSES } from '../../masters/gst/gst.types';

export const CUSTOMER_STATUSES = ['pending', 'active', 'inactive', 'rejected'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Edit Customer → "Invoice against": bill on the original POD or on a soft copy. */
export const CUSTOMER_INVOICE_AGAINST = ['original_pod', 'soft_copy'] as const;
export type CustomerInvoiceAgainst = (typeof CUSTOMER_INVOICE_AGAINST)[number];

/** The shared verified/unverified pair plus the bulk-import queue's states: 'pending' while the
 *  'gst-verification' job waits, 'failed' when the register rejected it or retries ran out. */
export const CUSTOMER_GST_STATUSES = [...GST_RECORD_STATUSES, 'pending', 'failed'] as const;
export type CustomerGstStatus = (typeof CUSTOMER_GST_STATUSES)[number];
