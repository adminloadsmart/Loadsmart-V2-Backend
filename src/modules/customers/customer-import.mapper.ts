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
    'deliveryunloadingpoints',
    'deliverylocations',
    'locations',
    'unloadingpoints',
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

function paymentTermsValue(raw: string | undefined): Partial<CreateCustomerInput> {
  if (raw === undefined) return {};

  const result: Partial<CreateCustomerInput> = {};
  const creditDays = raw.match(/credit\s*(\d+(?:\.\d+)?)\s*days?/i);
  const advancePercentage = raw.match(/advance\s*(\d+(?:\.\d+)?)\s*%/i);
  const balancePercentage = raw.match(/balance\s*(\d+(?:\.\d+)?)\s*%/i);

  if (creditDays) result.creditDays = Number(creditDays[1]);
  if (advancePercentage) result.advancePercentage = Number(advancePercentage[1]);
  if (balancePercentage) result.balancePercentage = Number(balancePercentage[1]);

  // Also support a plain numeric value when this column is used for credit days.
  if (!creditDays && !advancePercentage && !balancePercentage) {
    const parsed = numberValue(raw);
    if (parsed !== undefined && Number.isFinite(parsed)) result.creditDays = parsed;
  }

  return result;
}

function deliveryPointsValue(raw: string | undefined): CreateCustomerInput['deliveryPoints'] {
  if (raw === undefined) return undefined;

  // The preferred CSV representation is JSON so it can carry the exact same
  // delivery point objects accepted by POST /customers. Keep the pipe format
  // for existing CSV files that only contain location names.
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [{ location: '' }];
      return parsed as CreateCustomerInput['deliveryPoints'];
    } catch {
      return [{ location: '' }];
    }
  }

  return raw
    .split(/[|;]/)
    .map((location) => ({ location: location.trim() }))
    .filter((p) => p.location);
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
        if (field === 'creditDays' && normalizeHeader(header) === 'paymentterms') {
          Object.assign(data, paymentTermsValue(raw));
        } else {
          (data as Record<string, unknown>)[field] = numberValue(raw);
        }
      } else if (field === 'deliveryPoints') {
        data.deliveryPoints = deliveryPointsValue(raw);
      } else {
        (data as Record<string, unknown>)[field] = raw;
      }
    }
    return { row: index + 2, input: data };
  });
  return { rows, mapping };
}
