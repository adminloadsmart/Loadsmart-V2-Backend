import {
  enumOptions,
  ImportColumn,
  objectColumn,
  repeatGroup,
  topColumn,
  YES_NO_OPTIONS,
} from '../../../shared/import/columns';
import { PICKER_BODIES } from '../vehicle/truck-type-picker.constants';
import {
  TRANSPORTER_COMPANY_TYPES,
  TRANSPORTER_GST_TREATMENTS,
  TRANSPORTER_STATUSES,
} from './transporter.types';

/**
 * The transporter bulk-upload sheet — mirrors POST /masters/transporters (transporterValidators.
 * createTransporter). Keys are the payload field names, so headers written by older sheets and
 * the export ("bankAccountNumber", "creditDays"…) still map.
 */

export const CONTACT_GROUPS = 2;
export const LANE_GROUPS = 3;

const text = 'Text, up to';

const contacts = repeatGroup(CONTACT_GROUPS, 'contacts', 'Contact', [
  {
    field: 'fullName',
    label: 'Name',
    kind: 'text',
    required: 'no',
    format: `${text} 150 characters`,
    example: 'Rakesh Yadav',
  },
  {
    field: 'designation',
    label: 'Designation',
    kind: 'text',
    required: 'no',
    format: `${text} 100 characters`,
    example: 'Owner',
  },
  {
    field: 'phone',
    label: 'Phone',
    kind: 'text',
    required: 'group',
    format: '10–15 digits',
    example: '9876500011',
  },
  {
    field: 'email',
    label: 'Email',
    kind: 'text',
    required: 'no',
    format: 'Email address',
    example: 'rakesh@abclogistics.example',
  },
  {
    field: 'isWhatsapp',
    label: 'WhatsApp',
    kind: 'yesno',
    required: 'no',
    format: 'Yes or No',
    example: 'Yes',
    options: YES_NO_OPTIONS,
  },
]).map((column) =>
  // The export writes the first contact as POC Name / POC Phone / POC Email.
  'group' in column.target && column.target.index === 0
    ? {
        ...column,
        aliases: { fullName: ['pocname'], phone: ['pocphone'], email: ['pocemail'] }[
          column.target.field
        ],
      }
    : column,
);

const lanes = repeatGroup(LANE_GROUPS, 'lanes', 'Lane', [
  {
    field: 'originCity',
    label: 'From City',
    kind: 'text',
    required: 'group',
    format: `${text} 100 characters`,
    example: 'Pune',
  },
  {
    field: 'originState',
    label: 'From State',
    kind: 'text',
    required: 'no',
    format: `${text} 100 characters`,
    example: 'Maharashtra',
  },
  {
    field: 'destinationCity',
    label: 'To City',
    kind: 'text',
    required: 'group',
    format: `${text} 100 characters`,
    example: 'Delhi',
  },
  {
    field: 'destinationState',
    label: 'To State',
    kind: 'text',
    required: 'no',
    format: `${text} 100 characters`,
    example: 'Delhi',
  },
  {
    field: 'distanceKm',
    label: 'Distance (km)',
    kind: 'integer',
    required: 'no',
    format: 'Whole number, 1–10000',
    example: 1450,
  },
]);

const top = (
  field: string,
  header: string,
  kind: ImportColumn['kind'],
  format: string,
  example?: string | number,
  extra: Partial<ImportColumn> = {},
) => topColumn({ key: field, field, header, kind, required: 'no', format, example, ...extra });

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  top('name', 'Transporter Name', 'text', `${text} 150 characters`, 'ABC Logistics', {
    required: 'yes',
    aliases: ['transporter', 'companyname'],
  }),
  top('phone', 'Phone', 'text', '10–15 digits, unique per transporter', '9876543210', {
    required: 'yes',
    aliases: ['mobile', 'mobileno', 'phonenumber'],
  }),
  top(
    'gstin',
    'GSTIN',
    'text',
    '15-character GSTIN. Verified in the background after upload',
    '27ABCDE1234F1Z5',
    {
      aliases: ['gst', 'gstnumber'],
    },
  ),
  top('email', 'Email', 'text', 'Email address', 'accounts@abclogistics.example'),
  top('rate', 'Rate', 'text', `${text} 100 characters`, '25000'),
  top(
    'msmeRegistration',
    'MSME Registration',
    'text',
    `${text} 50 characters`,
    'UDYAM-MH-12-0012345',
    {
      aliases: ['msme', 'udyam'],
    },
  ),
  top('companyType', 'Company Type', 'enum', 'Pick the legal form', 'Private Limited', {
    options: enumOptions(TRANSPORTER_COMPANY_TYPES, {
      private_limited: 'Private Limited',
      public_limited: 'Public Limited',
      llp: 'LLP',
      huf: 'HUF',
    }),
  }),
  top(
    'gstTreatment',
    'GST Treatment',
    'enum',
    'Forward charge or Reverse charge',
    'Reverse charge',
    {
      options: enumOptions(TRANSPORTER_GST_TREATMENTS),
    },
  ),
  top('status', 'Status', 'enum', 'Active or Inactive (default Active)', 'Active', {
    options: enumOptions(TRANSPORTER_STATUSES),
  }),
  top('advancePercentage', 'Advance %', 'number', '0–100', 30, {
    aliases: ['advance'],
  }),
  top('creditDays', 'Credit Days', 'integer', 'Whole number, 0–36500', 7, {
    aliases: ['creditperiod'],
  }),
  top('trucksDeclared', 'Trucks Declared', 'integer', 'Whole number of trucks', 25, {
    aliases: ['fleetcount'],
  }),
  top('addressLine1', 'Address Line 1', 'text', `${text} 255 characters`, '12 MIDC Road'),
  top('addressLine2', 'Address Line 2', 'text', `${text} 255 characters`, 'Warehouse 4'),
  top('landmark', 'Landmark', 'text', `${text} 255 characters`, 'Near Main Gate'),
  top('areaLocality', 'Locality', 'text', `${text} 255 characters`, 'Bhosari'),
  top('city', 'City', 'text', `${text} 100 characters`, 'Pune'),
  top('state', 'State', 'text', `${text} 100 characters`, 'Maharashtra'),
  top('pinCode', 'PIN', 'text', '6 digits', '411026', { aliases: ['pin'] }),
  top('bankAccountNumber', 'Bank Account No', 'text', '6–30 characters', '123456789012'),
  top('bankIfsc', 'Bank IFSC', 'text', '11-character IFSC', 'HDFC0001234', {
    aliases: ['ifsc'],
  }),
  top(
    'bankAccountHolderName',
    'Account Holder Name',
    'text',
    `${text} 150 characters`,
    'ABC Logistics',
  ),
  top(
    'bankNameBranch',
    'Bank Name & Branch',
    'text',
    `${text} 150 characters`,
    'HDFC Bank, Bhosari',
  ),
  top('upiVpa', 'UPI ID', 'text', 'name@bank', 'abclogistics@hdfcbank', {
    aliases: ['upi'],
  }),
  objectColumn('truckType', {
    key: 'truckBodyType',
    field: 'bodyType',
    header: 'Truck Body',
    kind: 'enum',
    required: 'no',
    format: 'Open or Closed',
    example: 'Open',
    options: enumOptions(PICKER_BODIES),
  }),
  objectColumn('truckType', {
    key: 'truckWheelCount',
    field: 'wheelCount',
    header: 'Truck Wheels',
    kind: 'integer',
    required: 'no',
    format: 'Number of tyres, 4–22',
    example: 10,
  }),
  objectColumn('truckType', {
    key: 'truckCapacityTons',
    field: 'capacityTons',
    header: 'Truck Capacity (T)',
    kind: 'number',
    required: 'no',
    format: 'Tonnes, up to 100',
    example: 16,
  }),
  objectColumn('truckType', {
    key: 'truckLengthFt',
    field: 'lengthFt',
    header: 'Truck Length (ft)',
    kind: 'number',
    required: 'no',
    format: 'Feet, up to 80',
    example: 22,
  }),
  ...contacts,
  ...lanes,
];

export const IMPORT_COLUMNS: ImportColumn[] = TEMPLATE_COLUMNS;
