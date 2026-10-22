import { enumOptions, ImportColumn, topColumn } from '../../../shared/import/columns';
import {
  PRODUCT_CLASSIFICATIONS,
  PRODUCT_CONVERSION_MODELS,
  PRODUCT_DIMENSION_UNITS,
  PRODUCT_PACKAGINGS,
  PRODUCT_UNITS,
} from './product.types';

/**
 * The product bulk-upload sheet — mirrors POST /masters/products (productValidators.create).
 * Keys are the payload field names, so headers written by older sheets and the export still map.
 */

/** "A | B | C" or a JSON array of { name } → subItems. A malformed cell becomes one blank item
 *  so the validator reports it on the Sub Items column instead of failing the whole file. */
function parseSubItems(raw: string): { name: string }[] {
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [{ name: '' }];
      return parsed.map((item) => ({
        name:
          item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
            ? (item as { name: string }).name.trim()
            : '',
      }));
    } catch {
      return [{ name: '' }];
    }
  }
  return raw
    .split('|')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

const column = (
  field: string,
  header: string,
  kind: ImportColumn['kind'],
  format: string,
  example: string | number | undefined,
  extra: Partial<ImportColumn> = {},
) => topColumn({ key: field, field, header, kind, required: 'no', format, example, ...extra });

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  column(
    'productDetails',
    'Product Details',
    'text',
    'Product name, up to 255 characters',
    'Steel Rods',
    {
      required: 'yes',
      aliases: ['product', 'productname', 'name'],
    },
  ),
  column('hsnCode', 'HSN Code', 'text', '4 to 8 digits', '73089090', {
    aliases: ['hsn', 'hsnnumber'],
  }),
  column('packaging', 'Packaging', 'enum', 'How the goods are packed', 'Bundles', {
    options: enumOptions(PRODUCT_PACKAGINGS),
    aliases: ['package', 'packagetype'],
  }),
  column('classification', 'Classification', 'enum', 'Default Non hazardous', 'Non hazardous', {
    options: enumOptions(PRODUCT_CLASSIFICATIONS),
    aliases: ['hazardclass', 'hazardous'],
  }),
  column('invoiceValue', 'Invoice Value (₹)', 'number', 'Amount in rupees, 0 or more', 50000, {
    aliases: ['invoice', 'rate', 'price'],
  }),
  column(
    'billingUnit',
    'Unit',
    'text',
    `Up to 30 characters, e.g. ${PRODUCT_UNITS.join(', ')}`,
    'MT',
    {
      aliases: ['unit', 'billing'],
    },
  ),
  column('weight', 'Weight', 'number', 'Number, 0 or more', 500),
  column('weightUnit', 'Weight Unit', 'text', 'Up to 30 characters, e.g. kg, MT', 'kg', {
    aliases: ['weightmeasurementunit'],
  }),
  column('length', 'Length', 'number', 'Positive number, in the Dimension Unit', 6),
  column('width', 'Width', 'number', 'Positive number, in the Dimension Unit', 0.5),
  column('height', 'Height', 'number', 'Positive number, in the Dimension Unit', 0.5),
  column('dimensionUnit', 'Dimension Unit', 'enum', 'm, cm, ft or in (default m)', 'm', {
    options: enumOptions(PRODUCT_DIMENSION_UNITS, { m: 'm', cm: 'cm', ft: 'ft', in: 'in' }),
    aliases: ['scaleunit'],
  }),
  column(
    'conversionModel',
    'Conversion Model',
    'enum',
    'Surface road (1:4000) or Express air (1:6000); default Surface road',
    'Surface road',
    { options: enumOptions(PRODUCT_CONVERSION_MODELS) },
  ),
  column('dimensions', 'Dimensions', 'text', 'Free text, up to 100 characters', '6 × 0.5 × 0.5 m', {
    aliases: ['dimension', 'size'],
  }),
  column(
    'subItems',
    'Sub Items',
    'custom',
    'Names separated by |, e.g. Grade A | Grade B',
    'Grade A | Grade B',
    {
      parse: parseSubItems,
      aliases: ['subitem', 'variants', 'variant'],
    },
  ),
];

export const IMPORT_COLUMNS: ImportColumn[] = TEMPLATE_COLUMNS;
