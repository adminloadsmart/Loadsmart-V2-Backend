import {
  ImportColumn,
  legacyColumn,
  normalizeHeader,
  optionValue,
  repeatGroup,
  topColumn,
  YES_NO_OPTIONS,
} from '../../shared/import/columns';
import { numberValue } from '../../shared/import/parse';
import { CUSTOMER_INVOICE_AGAINST } from './utils/customer.status';

/**
 * The customer bulk-upload sheet — the one place a header is tied to a POST /customers field.
 * customer-import.sample.ts builds the template from TEMPLATE_COLUMNS and customer-import.mapper.ts
 * reads uploads through IMPORT_COLUMNS (template + legacy aliases), so the two can't drift apart.
 */

export const CONTACT_GROUPS = 2;
export const DELIVERY_POINT_GROUPS = 3;

export const INVOICE_AGAINST_LABELS: Record<(typeof CUSTOMER_INVOICE_AGAINST)[number], string> = {
  original_pod: 'Original POD',
  soft_copy: 'Soft copy',
};
const INVOICE_AGAINST_OPTIONS = CUSTOMER_INVOICE_AGAINST.map((value) => ({
  value,
  label: INVOICE_AGAINST_LABELS[value],
}));

/** "Original POD" / "soft copy" / "original" → the enum value. */
function invoiceAgainstValue(raw: string): string {
  const normalized = normalizeHeader(raw);
  if (normalized.includes('original')) return 'original_pod';
  if (normalized.includes('soft')) return 'soft_copy';
  return optionValue(INVOICE_AGAINST_OPTIONS, raw);
}

/** Legacy "Payment Terms" cell — "Credit 30 days, advance 20%" → creditDays / percentages. */
function applyPaymentTerms(draft: Record<string, unknown>, raw: string) {
  const creditDays = raw.match(/credit\s*(\d+(?:\.\d+)?)\s*days?/i);
  const advancePercentage = raw.match(/advance\s*(\d+(?:\.\d+)?)\s*%/i);
  const balancePercentage = raw.match(/balance\s*(\d+(?:\.\d+)?)\s*%/i);
  if (creditDays) draft.creditDays = Number(creditDays[1]);
  if (advancePercentage) draft.advancePercentage = Number(advancePercentage[1]);
  if (balancePercentage) draft.balancePercentage = Number(balancePercentage[1]);
  // A plain number in this column is credit days.
  if (!creditDays && !advancePercentage && !balancePercentage) {
    const parsed = numberValue(raw);
    if (Number.isFinite(parsed)) draft.creditDays = parsed;
  }
}

/** Legacy "Delivery Points" cell — a JSON array of POST /customers points, or "Pune | Nashik". */
function applyDeliveryPointList(draft: Record<string, unknown>, raw: string) {
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      draft.deliveryPoints = Array.isArray(parsed) ? parsed : [{ location: '' }];
    } catch {
      draft.deliveryPoints = [{ location: '' }];
    }
    return;
  }
  draft.deliveryPoints = raw
    .split(/[|;]/)
    .map((location) => ({ location: location.trim() }))
    .filter((point) => point.location);
}

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  topColumn({
    key: 'name',
    field: 'name',
    header: 'Customer Name',
    kind: 'text',
    required: 'yes',
    format: 'Text, up to 150 characters',
    example: 'Acme Logistics Pvt Ltd',
    aliases: ['name', 'customer', 'companyname', 'clientname', 'customerfullname'],
  }),
  topColumn({
    key: 'gstin',
    field: 'gstin',
    header: 'GSTIN',
    kind: 'text',
    required: 'one-of',
    requiredNote: 'GSTIN or Mobile is required',
    format: '15-character GSTIN. Verified in the background after upload',
    example: '27AAPFU0939F1ZV',
    aliases: ['gst', 'gstnumber', 'gstno', 'taxnumber'],
  }),
  topColumn({
    key: 'mobile',
    field: 'mobile',
    header: 'Mobile',
    kind: 'text',
    required: 'one-of',
    requiredNote: 'GSTIN or Mobile is required',
    format: '10–15 digits, unique per customer',
    example: '9876543210',
    aliases: ['mobileno', 'mobilenumber', 'phone', 'phonenumber', 'contactnumber', 'contact'],
  }),
  topColumn({
    key: 'registeredAddress',
    field: 'registeredAddress',
    header: 'Registered Address',
    kind: 'text',
    required: 'no',
    format: 'Text, up to 1000 characters. Filled from the GST register when left blank',
    example: 'Plot 12, MIDC Industrial Area, Andheri East, Mumbai, Maharashtra 400093',
    aliases: ['address', 'gstaddress'],
  }),
  ...repeatGroup(CONTACT_GROUPS, 'contacts', 'Contact', [
    {
      field: 'fullName',
      label: 'Name',
      kind: 'text',
      required: 'no',
      format: 'Text, up to 150 characters',
      example: 'Ravi Kumar',
    },
    {
      field: 'designation',
      label: 'Designation',
      kind: 'text',
      required: 'no',
      format: 'Text, up to 100 characters',
      example: 'Logistics Manager',
    },
    {
      field: 'phone',
      label: 'Phone',
      kind: 'text',
      required: 'group',
      format: '10–15 digits',
      example: '9876500001',
    },
    {
      field: 'email',
      label: 'Email',
      kind: 'text',
      required: 'group',
      format: 'Email address',
      example: 'ravi.kumar@acme.example',
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
  ]),
  ...repeatGroup(DELIVERY_POINT_GROUPS, 'deliveryPoints', 'Delivery Point', [
    {
      field: 'location',
      label: 'Location',
      kind: 'text',
      required: 'group',
      format: 'Name of the unloading point, up to 255 characters',
      example: 'Bhiwandi Warehouse',
    },
    ...(
      [
        ['addressLine1', 'Address Line 1', 'Text, up to 255 characters', 'Gala 4, Building B2'],
        ['addressLine2', 'Address Line 2', 'Text, up to 255 characters', 'Rahnal Village'],
        ['landmark', 'Landmark', 'Text, up to 255 characters', 'Near Mumbai–Nashik Highway'],
        ['areaLocality', 'Locality', 'Text, up to 255 characters', 'Rahnal'],
        ['city', 'City', 'Text, up to 100 characters', 'Bhiwandi'],
        ['state', 'State', 'Text, up to 100 characters', 'Maharashtra'],
        ['pinCode', 'PIN', '6 digits', '421302'],
        ['pocName', 'POC Name', 'Receiving person, up to 150 characters', 'Suresh Patil'],
        ['pocPhone', 'POC Phone', '10–15 digits', '9876500002'],
        ['pocEmail', 'POC Email', 'Email address', 'suresh.patil@acme.example'],
      ] as const
    ).map(([field, label, format, example]) => ({
      field,
      label,
      format,
      example,
      kind: 'text' as const,
      required: 'no' as const,
    })),
  ]),
  topColumn({
    key: 'invoiceAgainst',
    field: 'invoiceAgainst',
    header: 'Invoice Against',
    kind: 'enum',
    required: 'no',
    format: Object.values(INVOICE_AGAINST_LABELS).join(' or '),
    example: INVOICE_AGAINST_LABELS.original_pod,
    options: INVOICE_AGAINST_OPTIONS,
    parse: invoiceAgainstValue,
    aliases: ['invoicebasis', 'podbasis'],
  }),
  topColumn({
    key: 'creditDays',
    field: 'creditDays',
    header: 'Credit Days',
    kind: 'integer',
    required: 'no',
    format: 'Whole number, 0–36500',
    example: 30,
    aliases: ['paymentdays', 'creditperiod'],
  }),
  topColumn({
    key: 'creditLimit',
    field: 'creditLimit',
    header: 'Credit Limit (₹)',
    kind: 'number',
    required: 'no',
    format: 'Amount in rupees, 0 or more',
    example: 500000,
  }),
  topColumn({
    key: 'balanceAmount',
    field: 'balanceAmount',
    header: 'Balance Amount (₹)',
    kind: 'number',
    required: 'no',
    format: 'Amount in rupees, 0 or more',
    example: 0,
    aliases: ['outstandingbalance', 'openingbalance'],
  }),
  topColumn({
    key: 'freeHoursAtDrop',
    field: 'freeHoursAtDrop',
    header: 'Free Hours at Drop',
    kind: 'integer',
    required: 'no',
    format: 'Whole number of hours, 0–240',
    example: 24,
    aliases: ['freehours'],
  }),
  topColumn({
    key: 'notes',
    field: 'notes',
    header: 'Notes',
    kind: 'text',
    required: 'no',
    format: 'Text, up to 2000 characters',
    aliases: ['customnotes', 'remarks'],
  }),
];

/** Pre-redesign sheet columns, still read so existing customer files keep importing. */
const LEGACY_COLUMNS: ImportColumn[] = [
  legacyColumn({
    key: 'email',
    field: 'email',
    kind: 'text',
    aliases: ['emailid', 'emailaddress', 'mail'],
  }),
  legacyColumn({
    key: 'contactPersonName',
    field: 'contactPersonName',
    kind: 'text',
    aliases: ['contactname', 'personname'],
  }),
  legacyColumn({
    key: 'contactPersonNumber',
    field: 'contactPersonNumber',
    kind: 'text',
    aliases: ['contactpersonmobile', 'contactmobile', 'contactphone'],
  }),
  legacyColumn({
    key: 'contactPersonEmail',
    field: 'contactPersonEmail',
    kind: 'text',
    aliases: ['contactemail'],
  }),
  legacyColumn({
    key: 'contactPersonDesignation',
    field: 'contactPersonDesignation',
    kind: 'text',
    aliases: ['contactdesignation', 'designation'],
  }),
  legacyColumn({
    key: 'contactPersonDesignationOther',
    field: 'contactPersonDesignationOther',
    kind: 'text',
    aliases: ['otherdesignation'],
  }),
  legacyColumn({
    key: 'advancePercentage',
    field: 'advancePercentage',
    kind: 'number',
    aliases: ['advance', 'advancepercent', 'advancepct'],
  }),
  legacyColumn({
    key: 'balancePercentage',
    field: 'balancePercentage',
    kind: 'number',
    aliases: ['balance', 'balancepercent', 'balancepct'],
  }),
  legacyColumn({
    key: 'paymentTerms',
    field: 'creditDays',
    kind: 'custom',
    apply: applyPaymentTerms,
  }),
  legacyColumn({
    key: 'rateContract',
    field: 'rateContract',
    kind: 'text',
    aliases: ['contract', 'contractname', 'ratetype'],
  }),
  legacyColumn({
    key: 'deliveryPoints',
    field: 'deliveryPoints',
    kind: 'custom',
    apply: applyDeliveryPointList,
    aliases: [
      'deliverypoint',
      'deliveryunloadingpoints',
      'deliverylocations',
      'locations',
      'unloadingpoints',
      'deliveryaddress',
    ],
  }),
  legacyColumn({
    key: 'billingAddressLine1',
    field: 'billingAddressLine1',
    kind: 'text',
    aliases: ['billingaddress1', 'billingaddress'],
  }),
  legacyColumn({
    key: 'billingAddressLine2',
    field: 'billingAddressLine2',
    kind: 'text',
    aliases: ['billingaddress2'],
  }),
  legacyColumn({ key: 'billingLandmark', field: 'billingLandmark', kind: 'text' }),
  legacyColumn({
    key: 'billingAreaLocality',
    field: 'billingAreaLocality',
    kind: 'text',
    aliases: ['billinglocality'],
  }),
  legacyColumn({ key: 'billingCity', field: 'billingCity', kind: 'text' }),
  legacyColumn({ key: 'billingState', field: 'billingState', kind: 'text' }),
  legacyColumn({
    key: 'billingPinCode',
    field: 'billingPinCode',
    kind: 'text',
    aliases: ['billingpin', 'billingzip'],
  }),
];

export const IMPORT_COLUMNS: ImportColumn[] = [...TEMPLATE_COLUMNS, ...LEGACY_COLUMNS];
