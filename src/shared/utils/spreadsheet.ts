import { Workbook, CellValue } from 'exceljs';
import { parse } from 'csv-parse/sync';

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // A time-only cell (09:30) is stored as a time on Excel's 1899-12-30 epoch day.
    if (value.getUTCFullYear() < 1900) return value.toISOString().slice(11, 16);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

/** A data row with its 1-based sheet row number (header = row 1), so import errors can point at
 *  the row the user sees even when blank rows were skipped. */
export interface NumberedRow {
  row: number;
  record: Record<string, string>;
}

/**
 * Reads the first worksheet of an .xlsx file into row objects keyed by header
 * (row 1), mirroring the `{ columns: true, skip_empty_lines: true, trim: true }`
 * shape the CSV import mappers previously got from `csv-parse/sync`.
 */
export async function parseSpreadsheetRows(buffer: Buffer): Promise<Record<string, string>[]> {
  return (await parseNumberedSpreadsheetRows(buffer)).map(({ record }) => record);
}

/** parseSpreadsheetRows, keeping each row's sheet row number. */
export async function parseNumberedSpreadsheetRows(buffer: Buffer): Promise<NumberedRow[]> {
  const workbook = new Workbook();
  try {
    // exceljs's typings augment the global `Buffer` interface to also extend `ArrayBuffer`,
    // which newer @types/node's `Buffer` no longer satisfies structurally — cast around it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    throw new Error(
      `Invalid Excel file: ${error instanceof Error ? error.message : 'unable to parse file'}`,
      { cause: error },
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel file must contain at least one sheet');

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = cellText(cell.value);
  });

  // Every data row gets a key for every header column (blank cells become ''), matching
  // csv-parse's `columns: true` shape — a header only present on some rows must still map
  // consistently for every row, not just the rows that happened to have that cell filled in.
  const rows: NumberedRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let col = 1; col < headers.length; col += 1) {
      const header = headers[col];
      if (!header) continue;
      const raw = cellText(row.getCell(col).value);
      record[header] = raw;
      if (raw !== '') hasValue = true;
    }
    if (hasValue) rows.push({ row: rowNumber, record });
  });

  return rows;
}

/** A .csv upload in the same shape as parseNumberedSpreadsheetRows (UTF-8, optional BOM). */
export async function parseNumberedCsvRows(buffer: Buffer): Promise<NumberedRow[]> {
  let records: string[][];
  try {
    records = parse(buffer, { bom: true, relax_column_count: true, trim: true }) as string[][];
  } catch (error) {
    throw new Error(
      `Invalid CSV file: ${error instanceof Error ? error.message : 'unable to parse file'}`,
      { cause: error },
    );
  }
  const [headers = [], ...data] = records;
  const rows: NumberedRow[] = [];
  data.forEach((cells, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, col) => {
      if (header) record[header] = cells[col] ?? '';
    });
    if (Object.values(record).some((value) => value !== '')) rows.push({ row: index + 2, record });
  });
  return rows;
}
