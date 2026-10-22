import {
  enumOptions,
  ImportColumn,
  legacyColumn,
  normalizeHeader,
  topColumn,
} from '../../../shared/import/columns';
import { CONTRACT_BILLING_UNITS, CONTRACT_MAX_PRIORITY } from './contract.types';

/**
 * The contract bulk-upload sheet — mirrors POST /masters/contracts (contractValidators.create),
 * with the transporter named instead of referenced by id. The template's Transporter column is a
 * dropdown of this tenant's transporters (listSource 'transporters').
 */

export const TRANSPORTER_LIST = 'transporters';

const column = (
  field: string,
  header: string,
  kind: ImportColumn['kind'],
  format: string,
  example: string | number | undefined,
  extra: Partial<ImportColumn> = {},
) => topColumn({ key: field, field, header, kind, required: 'yes', format, example, ...extra });

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  column(
    'transporter',
    'Transporter',
    'text',
    'Pick from the dropdown, or type the transporter code, GSTIN or exact name',
    undefined,
    { listSource: TRANSPORTER_LIST },
  ),
  column('sourceCity', 'Source City', 'text', 'Up to 100 characters', 'Pune'),
  column('sourceState', 'Source State', 'text', 'Up to 100 characters', 'Maharashtra'),
  column('destinationCity', 'Destination City', 'text', 'Up to 100 characters', 'Delhi'),
  column('destinationState', 'Destination State', 'text', 'Up to 100 characters', 'Delhi'),
  column('agreedRate', 'Agreed Rate (₹)', 'number', 'Amount in rupees, more than 0', 45000, {
    aliases: ['rate'],
  }),
  column('billingUnit', 'Billing Unit', 'enum', 'Per ton or Per truck', 'Per truck', {
    options: enumOptions(CONTRACT_BILLING_UNITS),
    // "Per Truck" / "truck" / "per_truck" → per_truck; anything else is per ton (as before).
    parse: (raw) => (normalizeHeader(raw).includes('truck') ? 'per_truck' : 'per_ton'),
  }),
  column('validFrom', 'Valid From', 'date', 'Date (YYYY-MM-DD or DD-MM-YYYY)', '2026-11-01'),
  column('validTo', 'Valid To', 'date', 'Date on or after Valid From', '2027-10-31', {
    aliases: ['expirydate'],
  }),
  column(
    'priority',
    'Priority',
    'integer',
    `1–${CONTRACT_MAX_PRIORITY} (1 = primary carrier; "P1" works too)`,
    1,
    {
      aliases: ['ranking'],
      parse: (raw) => Number(raw.replace(/^p/i, '').trim()),
    },
  ),
  column(
    'sharePercentage',
    'Share %',
    'number',
    '0–100; shares on one lane add up to 100 at most',
    60,
    {
      required: 'no',
      aliases: ['share'],
    },
  ),
  column('notes', 'Notes', 'text', 'Up to 2000 characters', undefined, { required: 'no' }),
];

/** The pre-template way of naming the transporter, still read on upload. */
const LEGACY_COLUMNS: ImportColumn[] = [
  legacyColumn({
    key: 'transporterCode',
    field: 'transporterCode',
    kind: 'text',
    aliases: ['code'],
  }),
  legacyColumn({
    key: 'transporterGstin',
    field: 'transporterGstin',
    kind: 'text',
    aliases: ['gstin'],
  }),
  legacyColumn({ key: 'transporterName', field: 'transporterName', kind: 'text' }),
];

export const IMPORT_COLUMNS: ImportColumn[] = [...TEMPLATE_COLUMNS, ...LEGACY_COLUMNS];

/** "TRP-0001 · ABC Logistics" — the dropdown value for one transporter. */
export const transporterOptionLabel = (transporter: { code: string | null; name: string }) =>
  transporter.code ? `${transporter.code} · ${transporter.name}` : transporter.name;
