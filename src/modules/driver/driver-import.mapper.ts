import { parseSpreadsheetRows } from '../../shared/utils/spreadsheet';
import { ParsedDriverExcel } from './drivers.interface';
import {
  DRIVER_IMPORT_COLUMNS,
  DRIVER_IMPORT_ENUM_COLUMNS,
  DRIVER_IMPORT_LIST_COLUMNS,
  DRIVER_IMPORT_MAX_ROWS,
  DRIVER_IMPORT_NUMERIC_COLUMNS,
} from './driver.constants';

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** Normalized header (the key itself or any alias) → canonical column key. */
const KEY_BY_HEADER: Record<string, string> = Object.fromEntries(
  DRIVER_IMPORT_COLUMNS.flatMap(({ key, aliases = [] }) =>
    [key, ...aliases].map((header) => [normalizeHeader(header), key]),
  ),
);

function cell(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/** Unparseable text is passed through as-is so the zod schema reports it against the field. */
function parseValue(key: string, raw: string): unknown {
  if (DRIVER_IMPORT_NUMERIC_COLUMNS.has(key)) {
    const parsed = Number(raw.replace(/,/g, ''));
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (DRIVER_IMPORT_ENUM_COLUMNS.has(key))
    return raw
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[\s-]+/g, '_');
  if (key === 'bloodGroup') return raw.replace(/\s+/g, '').toUpperCase();
  if (DRIVER_IMPORT_LIST_COLUMNS.has(key))
    return raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  return raw;
}

/** Drops undefined entries; an object with nothing left is `undefined` so its block is omitted. */
function compact<T extends Record<string, unknown>>(fields: T): Partial<T> | undefined {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

/** Folds one flat sheet row into the nested shape `driverValidators.onboardDriver` expects. */
function buildOnboardBody(v: Record<string, unknown>): Record<string, unknown> {
  const {
    bankAccountNumber,
    bankIfsc,
    bankAccountHolderName,
    bankUpiId,
    operationalStatus,
    operationalStatusReason,
    ...driverFields
  } = v;
  return (
    compact({
      ...driverFields,
      bankDetails: compact({
        accountNumber: bankAccountNumber,
        ifsc: bankIfsc,
        accountHolderName: bankAccountHolderName,
        upiId: bankUpiId,
      }),
      operationalStatus: compact({
        operationalStatus,
        reason: operationalStatusReason,
      }),
    }) ?? {}
  );
}

export async function parseDriverExcel(buffer: Buffer): Promise<ParsedDriverExcel> {
  const records = await parseSpreadsheetRows(buffer);

  if (!records.length)
    throw new Error('Excel file must contain a header and at least one data row');
  if (records.length > DRIVER_IMPORT_MAX_ROWS)
    throw new Error(`Excel file cannot contain more than ${DRIVER_IMPORT_MAX_ROWS} rows`);

  const mapping: Record<string, string> = {};
  for (const header of Object.keys(records[0])) {
    const key = KEY_BY_HEADER[normalizeHeader(header)];
    if (!key) throw new Error(`Unexpected column "${header}"`);
    if (Object.values(mapping).includes(key)) throw new Error(`Multiple columns map to "${key}"`);
    mapping[header] = key;
  }

  for (const required of ['phoneNumber', 'licenseNumber', 'dateOfBirth']) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const flat: Record<string, unknown> = {};
    for (const [header, key] of Object.entries(mapping)) {
      const raw = cell(record[header]);
      if (raw !== undefined) flat[key] = parseValue(key, raw);
    }
    return { row: index + 2, input: buildOnboardBody(flat) };
  });
  return { rows, mapping };
}
