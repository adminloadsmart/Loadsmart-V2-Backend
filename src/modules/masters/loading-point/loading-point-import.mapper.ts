import { IMPORT_MAX_ROWS } from '../../../shared/import/upload';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../../shared/import/parse';
import { buildImportSample } from '../../../shared/import/sample';
import { CreateLoadingPointInput } from './loading-point.interface';
import { IMPORT_COLUMNS, TEMPLATE_COLUMNS } from './loading-point-import.columns';

export type ParsedLoadingPointSheet = ParsedImportSheet<CreateLoadingPointInput>;

export const LOADING_POINT_IMPORT_SAMPLE_FILENAME = 'loading-point-bulk-upload-template.xlsx';

export function parseLoadingPointSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedLoadingPointSheet> {
  return parseImportSheet<CreateLoadingPointInput>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [['title'], ['city'], ['state'], ['pinCode']],
  });
}

export function buildLoadingPointImportSample(): Promise<Buffer> {
  return buildImportSample({
    sheetName: 'Loading Points',
    columns: TEMPLATE_COLUMNS,
    notes: [
      'A loading point with the same Title and PIN as an earlier row, or an existing loading point, is reported and skipped.',
      'Latitude and Longitude are optional; without them the point is saved as a manual address. Pin it on the map in the app later for geofencing.',
    ],
  });
}
