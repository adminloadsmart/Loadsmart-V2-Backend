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
