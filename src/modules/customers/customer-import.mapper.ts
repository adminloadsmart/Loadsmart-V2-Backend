import { IMPORT_MAX_ROWS } from '../../shared/import/upload';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../shared/import/parse';
import { CreateCustomerInput } from './customer.types';
import { IMPORT_COLUMNS } from './customer-import.columns';

export type ParsedCustomerSheet = ParsedImportSheet<CreateCustomerInput>;

/** Reads a customer upload: contacts / delivery point groups become the POST /customers arrays. */
export function parseCustomerSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedCustomerSheet> {
  return parseImportSheet<CreateCustomerInput>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [['name'], ['gstin', 'mobile']],
    // The delivery point schema wants every address key present (nullable), not missing.
    groupDefaults: {
      deliveryPoints: {
        addressLine1: null,
        addressLine2: null,
        landmark: null,
        areaLocality: null,
        city: null,
        state: null,
        pinCode: null,
      },
    },
  });
}
