import { IMPORT_MAX_ROWS } from '../../../shared/import/upload';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../../shared/import/parse';
import { buildImportSample } from '../../../shared/import/sample';
import { CreateTransporterInput } from './transporter.interface';
import { IMPORT_COLUMNS, TEMPLATE_COLUMNS } from './transporter-import.columns';

export type ParsedTransporterSheet = ParsedImportSheet<CreateTransporterInput>;

export const TRANSPORTER_IMPORT_SAMPLE_FILENAME = 'transporter-bulk-upload-template.xlsx';

/** Reads a transporter upload: contact / lane groups and the truck columns become the
 *  POST /masters/transporters `contacts`, `lanes` and `truckType`. */
export function parseTransporterSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedTransporterSheet> {
  return parseImportSheet<CreateTransporterInput>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [['name'], ['phone']],
  });
}

export function buildTransporterImportSample(): Promise<Buffer> {
  return buildImportSample({
    sheetName: 'Transporters',
    columns: TEMPLATE_COLUMNS,
    notes: [
      'Phone must be unique — rows repeating a phone in the file, or matching an existing transporter, are reported and skipped.',
      'Contacts 1–2 and Lanes 1–3 are optional groups: leave a group blank, or fill at least its required columns. Add more in the app after upload.',
      'Transporters with a GSTIN are verified against the GST register in the background (one lookup every 2 minutes) and show Pending until then.',
      'Bank accounts are saved unverified; the penny-drop check runs when the transporter is next edited.',
    ],
  });
}
