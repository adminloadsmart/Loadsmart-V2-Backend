import { parseNumberedCsvRows, parseNumberedSpreadsheetRows } from '../utils/spreadsheet';
import {
  buildHeaderIndex,
  headerForPath,
  ImportColumn,
  normalizeHeader,
  optionValue,
} from './columns';

export type ImportFileType = 'xlsx' | 'csv';

/** Which group slot each array entry came from, so an error on `contacts.0.phone` can name the
 *  sheet's "Contact 2 Phone" when Contact 1 was blank. -1 = an entry a custom (legacy) column
 *  put in the array before the groups. */
export type GroupSlots = Record<string, number[]>;

export interface ParsedImportRow<T> {
  row: number;
  input: Partial<T>;
  slots: GroupSlots;
}

export interface ParsedImportSheet<T> {
  rows: ParsedImportRow<T>[];
  /** Sheet header → the column key it was read as. */
  mapping: Record<string, string>;
  /** Headers that match no column — skipped, and reported back so a typo is visible. */
  ignoredColumns: string[];
}

export interface ParseImportOptions {
  maxRows: number;
  /** Each entry is a set of column keys of which at least one must be present. */
  requiredColumns: string[][];
  /** Keys every entry of a group starts with (e.g. nullable address keys a schema insists on). */
  groupDefaults?: Record<string, Record<string, unknown>>;
}

export function numberValue(raw: string): number {
  const cleaned = raw.replace(/%|days?|hours?|hrs?|₹|,|rs\.?/gi, '').trim();
  const parsed = Number(cleaned);
  return cleaned !== '' && Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Yes/No cell → boolean; anything else passes through for the validator to reject. */
export function yesNoValue(raw: string): boolean | string {
  const normalized = raw.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0'].includes(normalized)) return false;
  return raw;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Excel serial day (days since 1899-12-30) → YYYY-MM-DD. */
function serialToIsoDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "2026-10-21", "21-10-2026", "21/10/2026" or an Excel serial → YYYY-MM-DD; else as typed. */
export function dateValue(raw: string): string {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  if (/^\d{5}(\.\d+)?$/.test(value)) return serialToIsoDate(Number(value));
  return value;
}

/** "9:00", "09:00", "9:00 PM", "21:00:00" or an Excel day fraction (0.375) → HH:mm. */
export function timeValue(raw: string): string {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (match) {
    let hours = Number(match[1]);
    const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return `${pad(hours)}:${match[2]}`;
  }
  if (/^0?\.\d+$|^1(\.0+)?$/.test(value)) {
    const minutes = Math.round(Number(value) * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  return value;
}

function cellValue(column: ImportColumn, raw: string): unknown {
  if (column.parse) return column.parse(raw);
  switch (column.kind) {
    case 'number':
    case 'integer':
      return numberValue(raw);
    case 'yesno':
      return yesNoValue(raw);
    case 'enum':
      return column.options ? optionValue(column.options, raw) : raw;
    case 'date':
      return dateValue(raw);
    case 'time':
      return timeValue(raw);
    default:
      return raw;
  }
}

/** Maps one sheet row (header → text) into a create input. Group slots become arrays (blank
 *  slots dropped, partly filled ones kept for the validator to report); nested objects are
 *  dropped when blank. */
export function mapImportRow<T>(
  record: Record<string, string>,
  mapping: Record<string, ImportColumn>,
  groupDefaults: Record<string, Record<string, unknown>> = {},
): { input: Partial<T>; slots: GroupSlots } {
  const data: Record<string, unknown> = {};
  const groups: Record<string, Record<string, unknown>[]> = {};
  const objects: Record<string, Record<string, unknown>> = {};

  for (const [header, column] of Object.entries(mapping)) {
    const raw = record[header]?.trim();
    if (raw === undefined || raw === '') continue;
    const { target } = column;
    if (column.kind === 'custom' && column.apply) {
      column.apply(data, raw);
    } else if ('group' in target) {
      const slots = (groups[target.group] ??= []);
      (slots[target.index] ??= {})[target.field] = cellValue(column, raw);
    } else if ('object' in target) {
      (objects[target.object] ??= {})[target.field] = cellValue(column, raw);
    } else {
      data[target.field] = cellValue(column, raw);
    }
  }

  const slots: GroupSlots = {};
  for (const [group, entries] of Object.entries(groups)) {
    const existing = Array.isArray(data[group]) ? (data[group] as unknown[]) : [];
    const merged: unknown[] = [...existing];
    slots[group] = existing.map(() => -1);
    entries.forEach((entry, index) => {
      if (!entry) return;
      merged.push({ ...groupDefaults[group], ...entry });
      slots[group].push(index);
    });
    if (merged.length) data[group] = merged;
  }
  Object.assign(data, objects);
  return { input: data as Partial<T>, slots };
}

/** Validation issue path (inside the payload) → the header the user sees in their sheet. */
export function fieldLabel(
  columns: ImportColumn[],
  path: PropertyKey[],
  slots: GroupSlots,
): string | undefined {
  if (!path.length) return undefined;
  const [first, second, ...rest] = path.map(String);
  const groupSlots = slots[first];
  if (groupSlots && second !== undefined) {
    const slot = groupSlots[Number(second)];
    if (slot === -1) return first;
    if (slot !== undefined && rest.length)
      return headerForPath(columns, `${first}.${slot}.${rest[0]}`);
  }
  if (second !== undefined && Number.isNaN(Number(second))) {
    const nested = headerForPath(columns, `${first}.${second}`);
    if (nested !== `${first}.${second}`) return nested;
  }
  return headerForPath(columns, first);
}

/** Reads an upload into mapped rows. Throws (for a 400) on an empty file, too many rows or a
 *  missing required column; unknown columns are skipped and listed in `ignoredColumns`. */
export async function parseImportSheet<T>(
  buffer: Buffer,
  fileType: ImportFileType,
  columns: ImportColumn[],
  options: ParseImportOptions,
): Promise<ParsedImportSheet<T>> {
  const records =
    fileType === 'csv'
      ? await parseNumberedCsvRows(buffer)
      : await parseNumberedSpreadsheetRows(buffer);
  if (!records.length) throw new Error('File must contain a header and at least one data row');
  if (records.length > options.maxRows)
    throw new Error(`File cannot contain more than ${options.maxRows} rows`);

  const index = buildHeaderIndex(columns);
  const mapping: Record<string, ImportColumn> = {};
  const ignoredColumns: string[] = [];
  for (const header of Object.keys(records[0].record)) {
    const column = index.get(normalizeHeader(header));
    if (!column) {
      ignoredColumns.push(header);
      continue;
    }
    if (Object.values(mapping).includes(column))
      throw new Error(`Multiple columns map to "${column.header}"`);
    mapping[header] = column;
  }
  const mapped = new Set(Object.values(mapping).map((column) => column.key));
  for (const anyOf of options.requiredColumns) {
    if (anyOf.some((key) => mapped.has(key))) continue;
    const names = anyOf.map((key) => `"${columns.find((c) => c.key === key)?.header ?? key}"`);
    throw new Error(`Missing required column ${names.join(' or ')}`);
  }

  // Rows with no value at all were already dropped; `row` is the sheet's own row number.
  const rows = records.map(({ row, record }) => ({
    row,
    ...mapImportRow<T>(record, mapping, options.groupDefaults),
  }));
  return {
    rows,
    mapping: Object.fromEntries(
      Object.entries(mapping).map(([header, column]) => [header, column.key]),
    ),
    ignoredColumns,
  };
}
