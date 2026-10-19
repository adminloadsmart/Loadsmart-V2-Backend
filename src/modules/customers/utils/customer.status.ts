export const CUSTOMER_STATUSES = ['pending', 'active', 'inactive', 'rejected'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Edit Customer → "Invoice against": bill on the original POD or on a soft copy. */
export const CUSTOMER_INVOICE_AGAINST = ['original_pod', 'soft_copy'] as const;
export type CustomerInvoiceAgainst = (typeof CUSTOMER_INVOICE_AGAINST)[number];
