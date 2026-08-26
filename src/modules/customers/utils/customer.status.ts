export const CUSTOMER_STATUSES = ['pending', 'active', 'inactive', 'rejected'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
