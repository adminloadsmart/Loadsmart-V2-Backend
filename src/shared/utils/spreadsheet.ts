import { Workbook, CellValue } from 'exceljs';

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

/**
 * Reads the first worksheet of an .xlsx file into row objects keyed by header
 * (row 1), mirroring the `{ columns: true, skip_empty_lines: true, trim: true }`
 * shape the CSV import mappers previously got from `csv-parse/sync`.
 */
export async function parseSpreadsheetRows(buffer: Buffer): Promise<Record<string, string>[]> {
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
  const rows: Record<string, string>[] = [];
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
    if (hasValue) rows.push(record);
  });

  return rows;
}
