import { ImportColumn } from './columns';
import { ParsedImportSheet } from './parse';
import { finishReport, ImportReport, ImportRowError, rowErrors, startReport } from './report';

interface SafeParser<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export interface RowImportSpec<T> {
  /** Columns the sheet was read with — used to name the column of each validation error. */
  columns: ImportColumn[];
  /** The create payload schema (the `body` of the single-create validator). */
  schema: SafeParser<T>;
  /** Natural key for "same record twice in this file"; null skips the check for that row. */
  duplicateKey?: (input: T) => string | null;
  duplicateError?: { field: string; message: string };
  /** An error for the row (it matches an existing record, a reference doesn't resolve…), else
   *  null. Runs after validation and the in-file duplicate check. */
  check?: (input: T) => Promise<Omit<ImportRowError, 'row'> | null>;
  /** Creates one record; a throw becomes that row's error. */
  create: (input: T) => Promise<unknown>;
}

/**
 * The bulk-upload loop shared by the master imports: validate every row like single create,
 * reject in-file and existing duplicates, then create the valid rows one by one so a bad row never
 * stops the rest. `dryRun` (preview) stops before creating.
 */
export async function importRows<T>(
  parsed: ParsedImportSheet<T>,
  spec: RowImportSpec<T>,
  options: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const errors: ImportRowError[] = [];
  const valid: { row: number; input: T }[] = [];
  const seen = new Set<string>();

  for (const item of parsed.rows) {
    const result = spec.schema.safeParse(item.input);
    if (!result.success) {
      errors.push(...rowErrors(spec.columns, item.row, result.error.issues, item.slots));
      continue;
    }
    const input = result.data;
    const key = spec.duplicateKey?.(input);
    if (key) {
      if (seen.has(key)) {
        errors.push({
          row: item.row,
          field: spec.duplicateError?.field,
          message: spec.duplicateError?.message ?? 'Duplicate of an earlier row in this file',
        });
        continue;
      }
      seen.add(key);
    }
    const problem = await spec.check?.(input);
    if (problem) {
      errors.push({ row: item.row, ...problem });
      continue;
    }
    valid.push({ row: item.row, input });
  }

  const report = startReport(parsed, valid.length, errors);
  if (options.dryRun) return report;
  for (const item of valid) {
    try {
      await spec.create(item.input);
      report.created += 1;
    } catch (error) {
      errors.push({
        row: item.row,
        message: error instanceof Error ? error.message : 'Failed to create this row',
      });
    }
  }
  return finishReport(report);
}
