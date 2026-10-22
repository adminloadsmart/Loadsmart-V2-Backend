import { IMPORT_MAX_ROWS } from '../../../shared/import/upload';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../../shared/import/parse';
import { buildImportSample } from '../../../shared/import/sample';
import { CreateProductInput } from './product.interface';
import { IMPORT_COLUMNS, TEMPLATE_COLUMNS } from './product-import.columns';

export type ParsedProductSheet = ParsedImportSheet<CreateProductInput>;

export const PRODUCT_IMPORT_SAMPLE_FILENAME = 'product-bulk-upload-template.xlsx';

export function parseProductSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedProductSheet> {
  return parseImportSheet<CreateProductInput>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [['productDetails']],
  });
}

export function buildProductImportSample(): Promise<Buffer> {
  return buildImportSample({
    sheetName: 'Products',
    columns: TEMPLATE_COLUMNS,
    notes: [
      'A product with the same name (any case) and HSN code as an earlier row, or an existing product, is reported and skipped.',
      'Length, Width and Height together give the volumetric weight; fill all three or none.',
    ],
  });
}
