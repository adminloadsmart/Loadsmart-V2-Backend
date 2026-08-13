import { parse } from 'csv-parse/sync';
import { CreateTransporterInput } from './utils/transporter.interface';

export const TRANSPORTER_IMPORT_MAX_ROWS = 5000;

export interface ParsedTransporterRow {
  row: number;
  input: Partial<CreateTransporterInput>;
}

export interface ParsedTransporterCsv {
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

export function parseTransporterCsv(buffer: Buffer): ParsedTransporterCsv {
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
  if (records.length > TRANSPORTER_IMPORT_MAX_ROWS)
    throw new Error(`CSV cannot contain more than ${TRANSPORTER_IMPORT_MAX_ROWS} rows`);

  const headers = Object.keys(records[0]);
  const expected = new Set(['name', 'rate', 'creditdays']);
  const mapping: Record<string, keyof CreateTransporterInput> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!expected.has(normalized)) throw new Error(`Unexpected column "${header}"`);
    const field = normalized === 'creditdays' ? 'creditDays' : (normalized as 'name' | 'rate');
    if (Object.values(mapping).includes(field))
      throw new Error(`Multiple columns map to "${field}"`);
    mapping[header] = field;
  }

  for (const required of ['name', 'rate', 'creditDays'] as const) {
    if (!Object.values(mapping).includes(required))
      throw new Error(`Missing required column "${required}"`);
  }

  const rows = records.map((record, index) => {
    const input: Partial<CreateTransporterInput> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const raw = value(record, header);
      if (field === 'creditDays') {
        const parsed = raw === undefined ? undefined : Number(raw.replace(/days?/i, '').trim());
        input.creditDays = parsed === undefined ? undefined : parsed;
      } else {
        input[field] = raw;
      }
    }
    return { row: index + 2, input };
  });
  return { rows, mapping };
}
