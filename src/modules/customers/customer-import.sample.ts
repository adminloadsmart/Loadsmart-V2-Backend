import { buildImportSample } from '../../shared/import/sample';
import { TEMPLATE_COLUMNS } from './customer-import.columns';

export const CUSTOMER_IMPORT_SAMPLE_FILENAME = 'customer-bulk-upload-template.xlsx';

/** The Customers "Download Sample Excel" workbook, built from TEMPLATE_COLUMNS. */
export function buildCustomerImportSample(): Promise<Buffer> {
  return buildImportSample({
    sheetName: 'Customers',
    columns: TEMPLATE_COLUMNS,
    notes: [
      'GSTIN and Mobile must be unique — rows repeating one in the file, or matching an existing customer, are reported and skipped.',
      'Contacts 1–2 and Delivery Points 1–3 are optional groups: leave a group blank, or fill at least its required columns. Add more in the app after upload.',
      'Customers with a GSTIN are verified against the GST register in the background (one lookup every 2 minutes) and show Pending until then.',
    ],
  });
}
