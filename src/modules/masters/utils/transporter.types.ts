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
