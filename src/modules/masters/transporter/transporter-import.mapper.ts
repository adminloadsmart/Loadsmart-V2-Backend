import { parseSpreadsheetRows } from '../../../shared/utils/spreadsheet';
import { CreateTransporterInput } from './transporter.interface';

export const TRANSPORTER_IMPORT_MAX_ROWS = 5000;

export interface ParsedTransporterRow {
  row: number;
  input: Partial<CreateTransporterInput>;
}

export interface ParsedTransporterExcel {
  rows: ParsedTransporterRow[];
  mapping: Record<string, keyof CreateTransporterInput>;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function value(row: Record<string, string>, header: string): string | undefined {
  const raw = row[header];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/** Fields stored as a number on `CreateTransporterInput` — parsed from the raw CSV string. */
const NUMERIC_FIELDS = new Set<keyof CreateTransporterInput>([
  'advancePercentage',
  'creditDays',
  'trucksDeclared',
]);

/** Columns the export writes that are derived/read-only — accepted and ignored on re-upload. */
const IGNORED_HEADERS = new Set([
  'code',
  'pan',
  'gstverification',
  'tripsdone',
  'freightowed',
  'rating',
]);

/** First POC card, written by the export as three flat columns. */
const POC_HEADERS: Record<string, 'fullName' | 'phone' | 'email'> = {
  pocname: 'fullName',
  pocphone: 'phone',
  pocemail: 'email',
};

/** Normalized header (see `normalizeHeader`) → `CreateTransporterInput` field it maps to. */
const FIELD_BY_HEADER: Record<string, keyof CreateTransporterInput> = {
  name: 'name',
  phone: 'phone',
  rate: 'rate',
  email: 'email',
  gstin: 'gstin',
  gst: 'gstin',
  msmeregistration: 'msmeRegistration',
  companytype: 'companyType',
  status: 'status',
  advancepercentage: 'advancePercentage',
  advance: 'advancePercentage',
  creditdays: 'creditDays',
  creditperiod: 'creditDays',
  addressline1: 'addressLine1',
  addressline2: 'addressLine2',
  landmark: 'landmark',
  arealocality: 'areaLocality',
  city: 'city',
  state: 'state',
  pincode: 'pinCode',
  bankaccountnumber: 'bankAccountNumber',
  bankifsc: 'bankIfsc',
  bankaccountholdername: 'bankAccountHolderName',
  banknamebranch: 'bankNameBranch',
  upivpa: 'upiVpa',
  upi: 'upiVpa',
  gsttreatment: 'gstTreatment',
  trucksdeclared: 'trucksDeclared',
  fleetcount: 'trucksDeclared',
};

export async function parseTransporterExcel(buffer: Buffer): Promise<ParsedTransporterExcel> {
  const records = await parseSpreadsheetRows(buffer);

  if (!records.length)
    throw new Error('Excel file must contain a header and at least one data row');
  if (records.length > TRANSPORTER_IMPORT_MAX_ROWS)
    throw new Error(`Excel file cannot contain more than ${TRANSPORTER_IMPORT_MAX_ROWS} rows`);

  const headers = Object.keys(records[0]);
  const mapping: Record<string, keyof CreateTransporterInput> = {};
  const pocHeaders: Record<string, 'fullName' | 'phone' | 'email'> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (IGNORED_HEADERS.has(normalized)) continue;
    if (POC_HEADERS[normalized]) {
      pocHeaders[header] = POC_HEADERS[normalized];
      continue;
    }
    const field = FIELD_BY_HEADER[normalized];
    if (!field) throw new Error(`Unexpected column "${header}"`);
    if (Object.values(mapping).includes(field))
      throw new Error(`Multiple columns map to "${field}"`);
    mapping[header] = field;
  }

  for (const required of ['name', 'phone'] as const) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const input: Partial<CreateTransporterInput> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = value(record, header);
      if (NUMERIC_FIELDS.has(field)) {
        const parsed = raw === undefined ? undefined : Number(raw.replace(/%|days?/gi, '').trim());
        (input as Record<string, unknown>)[field] = parsed;
      } else {
        (input as Record<string, unknown>)[field] = raw;
      }
    }
    const poc: Record<string, string> = {};
    for (const [header, key] of Object.entries(pocHeaders)) {
      const raw = value(record, header);
      if (raw !== undefined) poc[key] = raw;
    }
    if (poc.phone) input.contacts = [{ ...poc, phone: poc.phone }];
    return { row: index + 2, input };
  });
  return { rows, mapping };
}
