/** One CSV column: `header` is the first-row label, `value` reads the cell off a row. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

// RFC 4180 quoting: wrap in quotes when the cell holds a delimiter, quote or newline. A leading
// =, +, - or @ is prefixed with ' so a spreadsheet never evaluates an exported cell as a formula.
function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let cell = String(raw);
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

const UTF8_BOM = String.fromCharCode(0xfeff);

/** Settings → Masters "Export CSV". BOM-prefixed so Excel opens UTF-8 (₹, names) correctly. */
export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((column) => escapeCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(','));
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/** Sets the download headers and sends a CSV body — `<prefix>-YYYY-MM-DD.csv`. */
export function sendCsv(res: import('express').Response, filePrefix: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(body);
}

/** Export row cap — same ceiling the vehicle export uses (VEHICLE_EXPORT_MAX_ROWS). */
export const CSV_EXPORT_MAX_ROWS = 5000;
