import { Workbook } from 'exceljs';
import { ImportColumn, templateHeader } from './columns';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from './upload';

const REQUIRED_LABEL: Record<Exclude<ImportColumn['required'], 'one-of'>, string> = {
  yes: 'Required',
  no: 'Optional',
  group: 'Required when any other column of this group is filled',
};

const requiredLabel = (column: ImportColumn) =>
  column.required === 'one-of'
    ? (column.requiredNote ?? 'One of these columns is required')
    : REQUIRED_LABEL[column.required];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } } as const;
const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } } as const;
const LISTS_SHEET = 'Lists';

export interface ImportSampleOptions {
  /** Name of the data sheet, e.g. "Customers". */
  sheetName: string;
  /** Template columns, in sheet order (inTemplate ones). */
  columns: ImportColumn[];
  /** Master-specific lines for the Instructions sheet (after the general ones). */
  notes?: string[];
  /** Values for columns with a `listSource` — written to a hidden sheet as their dropdown. */
  lists?: Record<string, string[]>;
  /** Example-row values that depend on the tenant (e.g. the first transporter), by column key. */
  examples?: Record<string, string | number>;
}

/** Excel caps an inline list formula at 255 characters; longer lists go to the hidden sheet. */
const INLINE_LIST_LIMIT = 250;

/** A bulk-upload template: data sheet (headers, one example row, dropdowns) + Instructions. */
export async function buildImportSample(options: ImportSampleOptions): Promise<Buffer> {
  const { sheetName, columns, notes = [], lists = {}, examples = {} } = options;
  const workbook = new Workbook();
  workbook.creator = 'Loadsmart';

  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: templateHeader(column),
    key: column.key,
    width: Math.max(14, templateHeader(column).length + 4),
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.fill =
      column.required === 'yes' || column.required === 'one-of' ? REQUIRED_FILL : HEADER_FILL;
    cell.note = `${requiredLabel(column)}. ${column.format}`;
  });
  sheet.addRow(
    Object.fromEntries(
      columns.map((column) => [column.key, examples[column.key] ?? column.example ?? null]),
    ),
  );
  // Keep digit strings (phone, PIN, GSTIN, HSN) as text so Excel doesn't turn them into numbers.
  columns.forEach((column, index) => {
    if (column.kind === 'text') sheet.getColumn(index + 1).numFmt = '@';
  });

  // Lists: inline when short, otherwise one column each on a hidden sheet.
  let listsSheet: ReturnType<Workbook['addWorksheet']> | undefined;
  let listColumn = 0;
  const listFormula = (values: string[], title: string): string | null => {
    if (!values.length) return null;
    const inline = `"${values.join(',')}"`;
    if (inline.length <= INLINE_LIST_LIMIT && !values.some((value) => value.includes(',')))
      return inline;
    listsSheet ??= workbook.addWorksheet(LISTS_SHEET, { state: 'veryHidden' });
    const lists = listsSheet;
    listColumn += 1;
    lists.getCell(1, listColumn).value = title;
    values.forEach((value, i) => (lists.getCell(i + 2, listColumn).value = value));
    const letter = lists.getColumn(listColumn).letter;
    return `${LISTS_SHEET}!$${letter}$2:$${letter}$${values.length + 1}`;
  };

  for (const [index, column] of columns.entries()) {
    const values = column.listSource
      ? (lists[column.listSource] ?? [])
      : (column.options?.map((option) => option.label) ?? []);
    const formula = listFormula(values, column.header);
    if (!formula) continue;
    for (let row = 2; row <= IMPORT_MAX_ROWS + 1; row += 1) {
      sheet.getCell(row, index + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        // A free-text alternative (code, GSTIN, name) is still accepted for list-source columns.
        showErrorMessage: !column.listSource,
        errorTitle: column.header,
        error: `Choose a value from the list`,
      };
    }
  }

  const instructions = workbook.addWorksheet('Instructions');
  instructions.columns = [
    { header: 'Column', key: 'column', width: 34 },
    { header: 'Required?', key: 'required', width: 40 },
    { header: 'Format', key: 'format', width: 70 },
    { header: 'Example', key: 'example', width: 40 },
  ];
  instructions.getRow(1).font = { bold: true };
  for (const column of columns) {
    instructions.addRow({
      column: templateHeader(column),
      required: requiredLabel(column),
      format:
        column.options || column.listSource
          ? `${column.format} (pick from the dropdown)`
          : column.format,
      example: column.example ?? '',
    });
  }
  instructions.addRow({});
  for (const note of [
    `Fill one record per row on the "${sheetName}" sheet, starting at row 2. Blank rows are skipped.`,
    'Replace or delete the example row before uploading.',
    `Up to ${IMPORT_MAX_ROWS} rows per file, at most ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB. Accepted: .xlsx or .csv.`,
    'Rows with errors are skipped; every other row is saved. The result lists each error by row and column.',
    'Columns the import does not recognise are ignored and listed in the result.',
    ...notes,
  ]) {
    instructions.addRow({ column: note });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
