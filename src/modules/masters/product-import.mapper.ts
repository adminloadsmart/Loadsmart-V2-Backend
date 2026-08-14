import { parse } from 'csv-parse/sync';
import { CreateProductInput } from './utils/product.interface';

export const PRODUCT_IMPORT_MAX_ROWS = 5000;

export interface ParsedProductCsvRow {
  row: number;
  input: Partial<CreateProductInput>;
}

export interface ParsedProductCsv {
  rows: ParsedProductCsvRow[];
  mapping: Record<string, string>;
}

const aliases: Record<keyof CreateProductInput, string[]> = {
  productDetails: ['productdetails', 'product', 'productname', 'name'],
  hsnCode: ['hsncode', 'hsn', 'hsnnumber'],
  invoiceValue: ['invoicevalue', 'invoice', 'rate', 'price'],
  billingUnit: ['billingunit', 'unit', 'billing'],
  dimensions: ['dimensions', 'dimension', 'size'],
  weight: ['weight'],
  weightUnit: ['weightunit', 'weightmeasurementunit'],
  subItems: ['subitems', 'subitem', 'variants', 'variant'],
};

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

function parseSubItems(raw: string | undefined): { name: string }[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (raw.trim().startsWith('[')) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('subItems must be a JSON array');
    return parsed.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as { name?: unknown }).name !== 'string'
      )
        throw new Error('Each subItems entry must contain a name');
      return { name: (item as { name: string }).name.trim() };
    });
  }
  return raw
    .split('|')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

export function parseProductCsv(buffer: Buffer): ParsedProductCsv {
  let records: Record<string, string>[];
  try {
    records = parse(buffer.toString('utf8'), {
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
  if (records.length > PRODUCT_IMPORT_MAX_ROWS)
    throw new Error(`CSV cannot contain more than ${PRODUCT_IMPORT_MAX_ROWS} rows`);

  const mapping: Record<string, string> = {};
  for (const header of Object.keys(records[0])) {
    const field = (Object.keys(aliases) as (keyof CreateProductInput)[]).find((key) =>
      aliases[key].includes(normalizeHeader(header)),
    );
    if (field) {
      if (Object.values(mapping).includes(field))
        throw new Error(`Multiple columns map to "${field}"`);
      mapping[header] = field;
    }
  }
  if (!Object.values(mapping).includes('productDetails'))
    throw new Error('Missing required column "productDetails"');

  const rows = records.map((record, index) => {
    const input: Partial<CreateProductInput> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = record[header]?.trim();
      if (!raw) continue;
      if (field === 'invoiceValue' || field === 'weight')
        (input as Record<string, unknown>)[field] = parseNumber(raw);
      else if (field === 'subItems') input.subItems = parseSubItems(raw);
      else (input as Record<string, unknown>)[field] = raw;
    }
    return { row: index + 2, input };
  });
  return { rows, mapping };
}
