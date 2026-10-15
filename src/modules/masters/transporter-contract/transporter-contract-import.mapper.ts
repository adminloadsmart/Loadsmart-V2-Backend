import { parseSpreadsheetRows } from '../../../shared/utils/spreadsheet';

export const TRANSPORTER_CONTRACT_IMPORT_MAX_ROWS = 5000;

/** One sheet row after header mapping — still raw strings/numbers, validated downstream. */
export interface ContractImportFields {
  customerCode?: string;
  transporterPhone?: string;
  pickupCity?: string;
  pickupState?: string;
  dropCity?: string;
  dropState?: string;
  rate?: number;
  unit?: string;
  validFrom?: string;
  validTo?: string;
  priority?: number;
  sharePercent?: number;
}

export interface ParsedContractRow {
  row: number;
  input: ContractImportFields;
}

export interface ParsedContractExcel {
  rows: ParsedContractRow[];
  mapping: Record<string, keyof ContractImportFields>;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

const FIELD_BY_HEADER: Record<string, keyof ContractImportFields> = {
  customercode: 'customerCode',
  customer: 'customerCode',
  transporterphone: 'transporterPhone',
  transporter: 'transporterPhone',
  phone: 'transporterPhone',
  pickupcity: 'pickupCity',
  sourcecity: 'pickupCity',
  source: 'pickupCity',
  pickupstate: 'pickupState',
  sourcestate: 'pickupState',
  dropcity: 'dropCity',
  destinationcity: 'dropCity',
  destination: 'dropCity',
  dropstate: 'dropState',
  destinationstate: 'dropState',
  rate: 'rate',
  unit: 'unit',
  validfrom: 'validFrom',
  startdate: 'validFrom',
  validto: 'validTo',
  expirydate: 'validTo',
  contractexpirydate: 'validTo',
  expiry: 'validTo',
  priority: 'priority',
  ranking: 'priority',
  rank: 'priority',
  sharepercent: 'sharePercent',
  share: 'sharePercent',
  shareofbusiness: 'sharePercent',
};

const REQUIRED: (keyof ContractImportFields)[] = [
  'customerCode',
  'transporterPhone',
  'pickupCity',
  'pickupState',
  'dropCity',
  'dropState',
  'rate',
  'unit',
  'validTo',
  'priority',
  'sharePercent',
];

const UNIT_ALIASES: Record<string, 'per_tonne' | 'per_truck'> = {
  pertonne: 'per_tonne',
  perton: 'per_tonne',
  tonne: 'per_tonne',
  ton: 'per_tonne',
  mt: 'per_tonne',
  pertruck: 'per_truck',
  truck: 'per_truck',
  pertrip: 'per_truck',
  trip: 'per_truck',
  flat: 'per_truck',
};

/** "per ton", "Per Truck", "trip" → the stored unit; unknown text is left for validation to reject. */
export function normalizeUnit(raw: string): string {
  return UNIT_ALIASES[normalizeHeader(raw)] ?? raw;
}

/** "P1", "p 2", "2" → 1, 2, 2. NaN for anything else. */
function parsePriority(raw: string): number {
  return Number(raw.replace(/^p\s*/i, '').trim());
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/[₹,%\s]/g, '').replace(/^rs\.?/i, ''));
}

export async function parseTransporterContractExcel(buffer: Buffer): Promise<ParsedContractExcel> {
  const records = await parseSpreadsheetRows(buffer);

  if (!records.length)
    throw new Error('Excel file must contain a header and at least one data row');
  if (records.length > TRANSPORTER_CONTRACT_IMPORT_MAX_ROWS)
    throw new Error(
      `Excel file cannot contain more than ${TRANSPORTER_CONTRACT_IMPORT_MAX_ROWS} rows`,
    );

  const mapping: Record<string, keyof ContractImportFields> = {};
  for (const header of Object.keys(records[0])) {
    const field = FIELD_BY_HEADER[normalizeHeader(header)];
    if (!field) throw new Error(`Unexpected column "${header}"`);
    if (Object.values(mapping).includes(field))
      throw new Error(`Multiple columns map to "${field}"`);
    mapping[header] = field;
  }
  for (const required of REQUIRED) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const input: Record<string, unknown> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = record[header]?.trim();
      if (!raw) continue;
      if (field === 'rate' || field === 'sharePercent') input[field] = parseNumber(raw);
      else if (field === 'priority') input[field] = parsePriority(raw);
      else if (field === 'unit') input[field] = normalizeUnit(raw);
      else input[field] = raw;
    }
    return { row: index + 2, input: input as ContractImportFields };
  });
  return { rows, mapping };
}
