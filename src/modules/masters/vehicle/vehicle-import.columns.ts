import {
  enumOptions,
  ImportColumn,
  ImportColumnKind,
  legacyColumn,
  objectColumn,
  topColumn,
  YES_NO_OPTIONS,
} from '../../../shared/import/columns';
import { dateValue } from '../../../shared/import/parse';
import { PICKER_BODIES } from './truck-type-picker.constants';
import {
  AXLE_TYPES,
  COST_PAYERS,
  FUEL_TYPES,
  ONBOARD_OWNERSHIP_TYPES,
  TOLL_PAYERS,
  TYRE_CONDITION_PRESET_KEYS,
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VEHICLE_OPERATIONAL_STATUSES,
} from './vehicle.type';

/**
 * The Fleet bulk-upload sheet — mirrors POST /masters/vehicles/onboard
 * (vehicleValidators.onboardVehicle). Column keys are the flat keys the previous sheet used
 * ("registrationNumber", "rcExpiryDate"…), so older sheets still map and vehicle-import.errors.ts
 * keeps naming columns by the same keys. The driver is picked by phone (`driverPhone`, resolved
 * in VehicleImportService); `truckTypeId`, `driverId` and the RC photo URLs are upload-only.
 */

type Spec = {
  key: string;
  header: string;
  kind: ImportColumnKind;
  format: string;
  example?: string | number;
  required?: ImportColumn['required'];
  requiredNote?: string;
  options?: ImportColumn['options'];
  aliases?: string[];
};

const top = ({ required = 'no', ...spec }: Spec, field = spec.key) =>
  topColumn({ ...spec, field, required });
const nested = (object: string, field: string, { required = 'no', ...spec }: Spec) =>
  objectColumn(object, { ...spec, field, required });

/** One paper's cell → its entry in `documents` (created on first use, in column order). */
function documentApply(documentType: string, field: string, isDate: boolean) {
  return (draft: Record<string, unknown>, raw: string) => {
    const documents = (draft.documents ??= []) as Record<string, unknown>[];
    let document = documents.find((doc) => doc.documentType === documentType);
    if (!document) {
      document = { documentType };
      documents.push(document);
    }
    document[field] = isDate ? dateValue(raw) : raw;
  };
}

const PAPER_LABELS: Record<(typeof VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY)[number], [string, string]> =
  {
    rc: ['rc', 'RC'],
    insurance: ['insurance', 'Insurance'],
    permit: ['permit', 'Permit'],
    puc: ['puc', 'PUC'],
    fitness: ['fitness', 'Fitness'],
    road_tax: ['roadTax', 'Road Tax'],
  };

const PAPER_EXAMPLES: Partial<Record<string, string>> = {
  rcNumber: 'RC123456',
  rcIssueDate: '2022-03-15',
  rcExpiryDate: '2037-03-14',
  insuranceNumber: 'POL-998877',
  insuranceIssueDate: '2026-03-15',
  insuranceExpiryDate: '2027-03-14',
};

const paperColumns: ImportColumn[] = VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY.flatMap((type) => {
  const [prefix, label] = PAPER_LABELS[type];
  const column = (
    suffix: string,
    field: string,
    header: string,
    isDate: boolean,
  ): ImportColumn => ({
    key: `${prefix}${suffix}`,
    header: `${label} ${header}`,
    kind: 'custom',
    target: { field: 'documents' },
    required: 'no',
    format: isDate ? 'Date (YYYY-MM-DD or DD-MM-YYYY)' : 'Up to 50 characters',
    example: PAPER_EXAMPLES[`${prefix}${suffix}`],
    apply: documentApply(type, field, isDate),
    inTemplate: true,
  });
  return [
    column('Number', 'documentNumber', 'Number', false),
    ...(type === 'insurance'
      ? [
          {
            ...column('Provider', 'providerName', 'Provider', false),
            format: 'Insurer, up to 150 characters',
            example: 'ICICI Lombard',
          },
        ]
      : []),
    column('IssueDate', 'issueDate', 'Issue Date', true),
    column('ExpiryDate', 'expiryDate', 'Expiry Date', true),
  ];
});

const PAYER_LABELS = { self: 'Self', owner: 'Owner', driver: 'Driver' };

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  top({
    key: 'registrationNumber',
    header: 'Registration Number',
    kind: 'text',
    required: 'yes',
    format: 'As on the plate, e.g. KA01AB1234 (spaces are fine). Verified on VAHAN after upload',
    example: 'KA01AB1234',
    aliases: ['vehiclenumber', 'vehicleno', 'truckno', 'regno', 'plate'],
  }),
  nested('truckType', 'body', {
    key: 'truckBody',
    header: 'Truck Body',
    kind: 'enum',
    required: 'yes',
    format: 'Open or Closed',
    example: 'Open',
    options: enumOptions(PICKER_BODIES),
  }),
  nested('truckType', 'wheelCount', {
    key: 'wheelCount',
    header: 'Wheels',
    kind: 'integer',
    required: 'one-of',
    requiredNote: 'Wheels, or Axle Type for 32 ft containers',
    format: 'Number of tyres, e.g. 6, 10, 12',
    example: 6,
    aliases: ['tyres'],
  }),
  nested('truckType', 'axleType', {
    key: 'axleType',
    header: 'Axle Type',
    kind: 'enum',
    required: 'one-of',
    requiredNote: 'Wheels, or Axle Type for 32 ft containers',
    format: '32 ft containers only, instead of Wheels',
    options: enumOptions(AXLE_TYPES, {
      sxl: 'SXL',
      sxl_hc_9_5: 'SXL HC 9.5 ft',
      sxl_hc_10: 'SXL HC 10 ft',
      mxl: 'MXL',
      txl: 'TXL',
    }),
  }),
  nested('truckType', 'capacityTons', {
    key: 'capacityTons',
    header: 'Capacity (T)',
    kind: 'number',
    required: 'yes',
    format: 'Tonnes the truck is sold as',
    example: 10,
  }),
  nested('truckType', 'bodyLengthFt', {
    key: 'bodyLengthFt',
    header: 'Body Length (ft)',
    kind: 'text',
    required: 'yes',
    format: 'Feet, as the truck-type picker lists it, e.g. 22',
    example: '22',
  }),
  top({
    key: 'fuelType',
    header: 'Fuel Type',
    kind: 'enum',
    format: 'Diesel, Petrol, CNG or Electric',
    example: 'Diesel',
    options: enumOptions(FUEL_TYPES, { cng: 'CNG' }),
  }),
  top({
    key: 'makeModel',
    header: 'Make & Model',
    kind: 'text',
    format: 'Up to 100 characters',
    example: 'Tata Prima 2825.K',
  }),
  top({
    key: 'ownershipType',
    header: 'Ownership',
    kind: 'enum',
    format: 'Owned, Financed or Attached',
    example: 'Financed',
    options: enumOptions(ONBOARD_OWNERSHIP_TYPES),
  }),
  top({
    key: 'financierName',
    header: 'Financier',
    kind: 'text',
    format: 'Lender on a financed truck, up to 150 characters',
    example: 'HDFC Bank',
  }),
  top({
    key: 'grossVehicleWeightKg',
    header: 'Gross Weight (kg)',
    kind: 'integer',
    format: 'Whole kg',
    example: 28000,
  }),
  top({
    key: 'unladenWeightKg',
    header: 'Unladen Weight (kg)',
    kind: 'integer',
    format: 'Whole kg',
    example: 9500,
  }),
  top({
    key: 'emissionNorm',
    header: 'Emission Norm',
    kind: 'text',
    format: 'e.g. BS6',
    example: 'BS6',
  }),
  top({
    key: 'vahanBodyType',
    header: 'VAHAN Body Type',
    kind: 'text',
    format: 'As on the RC; filled from VAHAN when blank',
  }),
  nested('cost', 'emiAmount', {
    key: 'emiAmount',
    header: 'EMI Amount (₹)',
    kind: 'number',
    format: 'Owned / financed trucks',
    example: 45000,
  }),
  nested('cost', 'emiMonthsLeft', {
    key: 'emiMonthsLeft',
    header: 'EMI Months Left',
    kind: 'integer',
    format: 'Owned / financed trucks, 1–360',
    example: 36,
  }),
  nested('cost', 'insurancePremiumYearly', {
    key: 'insurancePremiumYearly',
    header: 'Insurance Premium / Year (₹)',
    kind: 'number',
    format: 'Owned / financed trucks',
    example: 85000,
  }),
  nested('cost', 'leaseRentMonthly', {
    key: 'leaseRentMonthly',
    header: 'Lease Rent / Month (₹)',
    kind: 'number',
    format: 'Attached trucks only',
  }),
  nested('cost', 'leaseEndDate', {
    key: 'leaseEndDate',
    header: 'Lease End Date',
    kind: 'date',
    format: 'Attached trucks only; date',
  }),
  nested('cost', 'fuelPaidBy', {
    key: 'fuelPaidBy',
    header: 'Fuel Paid By',
    kind: 'enum',
    format: 'Attached trucks only: Self, Owner or Driver',
    options: enumOptions(COST_PAYERS, PAYER_LABELS),
  }),
  nested('cost', 'tollPaidBy', {
    key: 'tollPaidBy',
    header: 'Toll Paid By',
    kind: 'enum',
    format: 'Attached trucks only: Self or Owner',
    options: enumOptions(TOLL_PAYERS, PAYER_LABELS),
  }),
  nested('gps', 'hasGps', {
    key: 'hasGps',
    header: 'Has GPS',
    kind: 'yesno',
    format: 'Yes or No',
    example: 'Yes',
    options: YES_NO_OPTIONS,
  }),
  nested('gps', 'provider', {
    key: 'gpsProvider',
    header: 'GPS Provider',
    kind: 'text',
    format: 'Needs Has GPS = Yes',
    example: 'Fleetx',
  }),
  nested('gps', 'deviceImei', {
    key: 'gpsDeviceImei',
    header: 'GPS IMEI',
    kind: 'text',
    format: '15 digits; needs Has GPS = Yes',
    example: '123456789012345',
  }),
  nested('serviceUsage', 'odometerKm', {
    key: 'odometerKm',
    header: 'Odometer (km)',
    kind: 'integer',
    format: 'Whole km',
    example: 84500,
  }),
  nested('serviceUsage', 'lastServiceDate', {
    key: 'lastServiceDate',
    header: 'Last Service Date',
    kind: 'date',
    format: 'Date',
    example: '2026-08-10',
  }),
  nested('serviceUsage', 'lastServiceOdometerKm', {
    key: 'lastServiceOdometerKm',
    header: 'Last Service Odometer (km)',
    kind: 'integer',
    format: 'Whole km',
    example: 80000,
  }),
  nested('serviceUsage', 'lastTyreChangeBrand', {
    key: 'lastTyreChangeBrand',
    header: 'Last Tyre Brand',
    kind: 'text',
    format: 'Up to 100 characters',
    example: 'MRF',
  }),
  nested('serviceUsage', 'lastTyreChangeDate', {
    key: 'lastTyreChangeDate',
    header: 'Last Tyre Change Date',
    kind: 'date',
    format: 'Date',
    example: '2026-05-01',
  }),
  nested('serviceUsage', 'serviceIntervalKm', {
    key: 'serviceIntervalKm',
    header: 'Service Every (km)',
    kind: 'integer',
    format: 'Whole km',
    example: 10000,
  }),
  nested('serviceUsage', 'serviceIntervalMonths', {
    key: 'serviceIntervalMonths',
    header: 'Service Every (months)',
    kind: 'integer',
    format: '1–120',
    example: 6,
  }),
  nested('tyres', 'preset', {
    key: 'tyrePreset',
    header: 'Tyre Condition',
    kind: 'enum',
    format: 'New, Mostly good, Half worn or Near replacement (not for attached trucks)',
    example: 'Mostly good',
    options: enumOptions(TYRE_CONDITION_PRESET_KEYS),
  }),
  nested('operationalStatus', 'operationalStatus', {
    key: 'operationalStatus',
    header: 'Operational Status',
    kind: 'enum',
    format: 'Default Idle',
    example: 'Idle',
    options: enumOptions(VEHICLE_OPERATIONAL_STATUSES),
  }),
  nested('operationalStatus', 'reason', {
    key: 'operationalStatusReason',
    header: 'Status Reason',
    kind: 'text',
    format: 'Up to 500 characters',
  }),
  ...paperColumns,
  top(
    {
      key: 'driverPhone',
      header: 'Driver Phone',
      kind: 'text',
      format: 'Mobile of an active driver in your fleet — links them to this truck',
    },
    'driverPhone',
  ),
  nested('driverLink', 'isPrimary', {
    key: 'driverIsPrimary',
    header: 'Primary Driver',
    kind: 'yesno',
    format: 'Yes or No; needs Driver Phone',
    options: YES_NO_OPTIONS,
  }),
  nested('driverLink', 'linkedFrom', {
    key: 'driverLinkedFrom',
    header: 'Driver Linked From',
    kind: 'date',
    format: 'Date; needs Driver Phone',
  }),
];

/** Upload-only columns of the previous sheet that need ids or file URLs. */
const LEGACY_COLUMNS: ImportColumn[] = [
  legacyColumn({ key: 'truckTypeId', field: 'truckTypeId', kind: 'text' }),
  {
    ...nested('driverLink', 'driverId', {
      key: 'driverId',
      header: 'driverId',
      kind: 'text',
      format: '',
    }),
    inTemplate: false,
  },
  {
    ...legacyColumn({ key: 'rcFrontUrl', field: 'documents', kind: 'custom' }),
    apply: documentApply('rc_front', 'fileUrl', false),
  },
  {
    ...legacyColumn({ key: 'rcBackUrl', field: 'documents', kind: 'custom' }),
    apply: documentApply('rc_back', 'fileUrl', false),
  },
];

export const IMPORT_COLUMNS: ImportColumn[] = [...TEMPLATE_COLUMNS, ...LEGACY_COLUMNS];
