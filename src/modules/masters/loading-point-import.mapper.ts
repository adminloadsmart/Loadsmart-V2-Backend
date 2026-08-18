import { parse } from 'csv-parse/sync';
import { CreateLoadingPointInput } from './utils/loading-point.interface';

export const LOADING_POINT_IMPORT_MAX_ROWS = 5000;

export interface ParsedLoadingPointRow {
  row: number;
  input: Partial<CreateLoadingPointInput>;
}

export interface ParsedLoadingPointCsv {
  rows: ParsedLoadingPointRow[];
  mapping: Record<string, keyof CreateLoadingPointInput>;
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

/** Fields stored as a number on `CreateLoadingPointInput` — parsed from the raw CSV string. */
const NUMERIC_FIELDS = new Set<keyof CreateLoadingPointInput>(['latitude', 'longitude']);

/** Normalized header (see `normalizeHeader`) → `CreateLoadingPointInput` field it maps to. */
const FIELD_BY_HEADER: Record<string, keyof CreateLoadingPointInput> = {
  title: 'title',
  name: 'title',
  addressline1: 'addressLine1',
  address1: 'addressLine1',
  address: 'addressLine1',
  addressline2: 'addressLine2',
  address2: 'addressLine2',
  landmark: 'landmark',
  arealocality: 'areaLocality',
  locality: 'areaLocality',
  area: 'areaLocality',
  city: 'city',
  state: 'state',
  pincode: 'pinCode',
  pin: 'pinCode',
  zipcode: 'pinCode',
  latitude: 'latitude',
  lat: 'latitude',
  longitude: 'longitude',
  lng: 'longitude',
  long: 'longitude',
  contactpersonname: 'contactPersonName',
  contactname: 'contactPersonName',
  contactpersonnumber: 'contactPersonNumber',
  contactnumber: 'contactPersonNumber',
  contactphone: 'contactPersonNumber',
  contactpersonemail: 'contactPersonEmail',
  contactemail: 'contactPersonEmail',
};

export function parseLoadingPointCsv(buffer: Buffer): ParsedLoadingPointCsv {
  let records: Record<string, string>[];
  try {
    records = parse(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: false,
    }) as Record<string, string>[];
  } catch (error) {
    throw new Error(
      `Invalid CSV: ${error instanceof Error ? error.message : 'unable to parse file'}`,
      { cause: error },
    );
  }

  if (!records.length) throw new Error('CSV must contain a header and at least one data row');
  if (records.length > LOADING_POINT_IMPORT_MAX_ROWS)
    throw new Error(`CSV cannot contain more than ${LOADING_POINT_IMPORT_MAX_ROWS} rows`);

  const headers = Object.keys(records[0]);
  const mapping: Record<string, keyof CreateLoadingPointInput> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const field = FIELD_BY_HEADER[normalized];
    if (!field) throw new Error(`Unexpected column "${header}"`);
    if (Object.values(mapping).includes(field))
      throw new Error(`Multiple columns map to "${field}"`);
    mapping[header] = field;
  }

  for (const required of ['title', 'addressLine1', 'city', 'state', 'pinCode'] as const) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const input: Partial<CreateLoadingPointInput> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = value(record, header);
      if (NUMERIC_FIELDS.has(field)) {
        (input as Record<string, unknown>)[field] = raw === undefined ? undefined : Number(raw);
      } else {
        (input as Record<string, unknown>)[field] = raw;
      }
    }
    return { row: index + 2, input };
  });
  return { rows, mapping };
}
