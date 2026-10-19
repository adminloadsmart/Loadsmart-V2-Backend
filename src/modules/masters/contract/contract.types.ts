/** Add a contract → "Billing unit": the agreed rate is per ton or per truck. */
export const CONTRACT_BILLING_UNITS = ['per_ton', 'per_truck'] as const;
export type ContractBillingUnit = (typeof CONTRACT_BILLING_UNITS)[number];

/** Derived from validity, never stored: upcoming (starts later), active, expiring (ends within
 *  CONTRACT_EXPIRING_WINDOW_DAYS), expired. */
export const CONTRACT_DISPLAY_STATUSES = ['upcoming', 'active', 'expiring', 'expired'] as const;
export type ContractDisplayStatus = (typeof CONTRACT_DISPLAY_STATUSES)[number];

export const CONTRACT_EXPIRING_WINDOW_DAYS = 30;

/** P1 = primary carrier (gets the load first in dispatch indent automation), P2, … */
export const CONTRACT_MAX_PRIORITY = 9;

export const CONTRACT_SORT_FIELDS = ['share', 'priority', 'validTo', 'createdAt', 'rate'] as const;
export type ContractSortField = (typeof CONTRACT_SORT_FIELDS)[number];
