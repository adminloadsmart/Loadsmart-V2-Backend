import { parse } from 'csv-parse/sync';
import { CreateCustomerInput } from './customer.types';

export const CUSTOMER_IMPORT_MAX_ROWS = 5000;

const aliases: Record<keyof CreateCustomerInput, string[]> = {
  name: ['name', 'customername', 'customer', 'companyname', 'clientname', 'customerfullname'],
  mobile: [
    'mobile',
    'mobileno',
    'mobilenumber',
    'phone',
    'phonenumber',
    'contactnumber',
    'contact',
  ],
  email: ['email', 'emailid', 'emailaddress', 'mail'],
  gstin: ['gstin', 'gst', 'gstnumber', 'gstno', 'taxnumber'],
  advancePercentage: ['advancepercentage', 'advance', 'advancepercent', 'advancepct'],
  balancePercentage: ['balancepercentage', 'balance', 'balancepercent', 'balancepct'],
  creditDays: ['creditdays', 'paymentdays', 'paymentterms', 'creditperiod'],
  rateContract: ['ratecontract', 'contract', 'contractname', 'ratetype'],
  deliveryPoints: [
    'deliverypoints',
    'deliverypoint',
    'deliverylocations',
    'locations',
    'deliveryaddress',
  ],
  billingAddressLine1: ['billingaddressline1', 'billingaddress1', 'billingaddress'],
  billingAddressLine2: ['billingaddressline2', 'billingaddress2'],
  billingLandmark: ['billinglandmark'],
  billingAreaLocality: ['billingarealocality', 'billinglocality'],
  billingCity: ['billingcity'],
  billingState: ['billingstate'],
  billingPinCode: ['billingpincode', 'billingpin', 'billingzip'],
};

export interface ParsedImportRow {
  row: number;
  input: Partial<CreateCustomerInput>;
}

export interface ParsedCustomerCsv {
  rows: ParsedImportRow[];
  mapping: Record<string, keyof CreateCustomerInput>;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function findField(header: string): keyof CreateCustomerInput | undefined {
  const normalized = normalizeHeader(header);
  const matches = (Object.keys(aliases) as (keyof CreateCustomerInput)[]).filter((field) =>
    aliases[field].includes(normalized),
  );
  if (matches.length > 1) throw new Error(`Ambiguous column "${header}"`);
  return matches[0];
}

function value(row: Record<string, string>, header: string): string | undefined {
  const raw = row[header];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function numberValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/%|days?/gi, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseCustomerCsv(buffer: Buffer): ParsedCustomerCsv {
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
  if (records.length > CUSTOMER_IMPORT_MAX_ROWS) {
    throw new Error(`CSV cannot contain more than ${CUSTOMER_IMPORT_MAX_ROWS} rows`);
  }

  const headers = Object.keys(records[0]);
  const mapping: Record<string, keyof CreateCustomerInput> = {};
  for (const header of headers) {
    const field = findField(header);
    if (field) {
      if (Object.values(mapping).includes(field))
        throw new Error(`Multiple columns map to "${field}"`);
      mapping[header] = field;
    }
  }
  for (const required of ['name', 'mobile'] as const) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const data: Partial<CreateCustomerInput> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = value(record, header);
      if (
        field === 'advancePercentage' ||
        field === 'balancePercentage' ||
        field === 'creditDays'
      ) {
        (data as Record<string, unknown>)[field] = numberValue(raw);
      } else if (field === 'deliveryPoints') {
        data.deliveryPoints = raw
          ?.split('|')
          .map((location) => ({ location: location.trim() }))
          .filter((p) => p.location);
      } else {
        (data as Record<string, unknown>)[field] = raw;
      }
    }
    return { row: index + 2, input: data };
  });
  return { rows, mapping };
}
