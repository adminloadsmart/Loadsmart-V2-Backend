export const CUSTOMER_STATUSES = ['pending', 'active'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
