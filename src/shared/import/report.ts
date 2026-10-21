import { ImportColumn } from './columns';
import { fieldLabel, GroupSlots, ParsedImportSheet } from './parse';

/** Every master import (and its preview) answers with this shape. */
export interface ImportRowError {
  row: number;
  /** The sheet header the problem is in, when it belongs to one cell. */
  field?: string;
  message: string;
}

export interface ImportReport {
  /** Non-blank data rows in the file. */
  total: number;
  /** Rows that passed validation and duplicate checks (= what the import tried to create). */
  validRows: number;
  created: number;
  /** Rows with at least one error — every error is listed in `errors`. */
  failed: number;
  /** Created records whose GSTIN was queued for background verification (GST masters only). */
  gstVerificationQueued?: number;
  columnMapping: Record<string, string>;
  ignoredColumns: string[];
  errors: ImportRowError[];
}

export function countFailedRows(errors: ImportRowError[]): number {
  return new Set(errors.map((error) => error.row)).size;
}

/** An empty report for a parsed sheet; the import fills `created`/`errors` as it goes and calls
 *  finishReport at the end. */
export function startReport(
  parsed: Pick<ParsedImportSheet<unknown>, 'rows' | 'mapping' | 'ignoredColumns'>,
  validRows: number,
  errors: ImportRowError[],
): ImportReport {
  return {
    total: parsed.rows.length,
    validRows,
    created: 0,
    failed: countFailedRows(errors),
    columnMapping: parsed.mapping,
    ignoredColumns: parsed.ignoredColumns,
    errors,
  };
}

/** Sorts errors by row and recounts the failed rows. */
export function finishReport(report: ImportReport): ImportReport {
  report.errors.sort((a, b) => a.row - b.row);
  report.failed = countFailedRows(report.errors);
  return report;
}

/** Zod issues (paths relative to the payload) → row errors naming the sheet columns. */
export function rowErrors(
  columns: ImportColumn[],
  row: number,
  issues: { path: PropertyKey[]; message: string }[],
  slots: GroupSlots,
): ImportRowError[] {
  return issues.map((issue) => ({
    row,
    field: fieldLabel(columns, issue.path, slots),
    message: issue.message,
  }));
}
