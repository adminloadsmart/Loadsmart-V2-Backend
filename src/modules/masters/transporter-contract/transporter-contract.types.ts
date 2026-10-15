/**
 * Contract-side value sets, declared once as `const` tuples so the entity's enum column and the
 * request schemas can never drift apart (same pattern as transporter.types.ts).
 */

/** What `rate` is quoted against: every tonne carried, or every truck sent. */
export const CONTRACT_UNITS = ['per_tonne', 'per_truck'] as const;
export type ContractUnit = (typeof CONTRACT_UNITS)[number];

/** List filter — `expiring_soon` is valid today with `validTo` inside EXPIRING_SOON_DAYS. */
export const CONTRACT_STATUS_FILTERS = ['active', 'expired', 'expiring_soon', 'upcoming'] as const;
export type ContractStatusFilter = (typeof CONTRACT_STATUS_FILTERS)[number];

export const EXPIRING_SOON_DAYS = 30;
