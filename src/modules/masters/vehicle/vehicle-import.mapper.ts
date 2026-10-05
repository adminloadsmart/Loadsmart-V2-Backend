import { parseSpreadsheetRows } from '../../../shared/utils/spreadsheet';
import { OnboardVehicleInput } from './vehicle.interface';

export const VEHICLE_IMPORT_MAX_ROWS = 1000;

export interface ParsedVehicleRow {
  row: number;
  input: Record<string, unknown>;
}

export interface ParsedVehicleExcel {
  rows: ParsedVehicleRow[];
  mapping: Record<string, string>;
}

/**
 * One column per flattened onboard field, in sheet order. `example` is a sample value
 * (a financed 10 T open truck) the mapper test feeds through the onboard schema.
 */
export const VEHICLE_IMPORT_COLUMNS: { key: string; example?: string | number }[] = [
  { key: 'registrationNumber', example: 'KA01AB1234' },
  { key: 'truckTypeId' },
  { key: 'truckBody', example: 'open' },
  { key: 'wheelCount', example: 6 },
  { key: 'axleType' },
  { key: 'capacityTons', example: 10 },
  { key: 'bodyLengthFt', example: '22' },
  { key: 'fuelType', example: 'diesel' },
  { key: 'makeModel', example: 'Tata Prima 2825.K' },
  { key: 'ownershipType', example: 'financed' },
  { key: 'financierName', example: 'HDFC Bank' },
  { key: 'grossVehicleWeightKg', example: 28000 },
  { key: 'unladenWeightKg', example: 9500 },
  { key: 'emissionNorm', example: 'BS6' },
  { key: 'vahanBodyType' },
  { key: 'emiAmount', example: 45000 },
  { key: 'emiMonthsLeft', example: 36 },
  { key: 'insurancePremiumYearly', example: 85000 },
  { key: 'leaseRentMonthly' },
  { key: 'leaseEndDate' },
  { key: 'fuelPaidBy' },
  { key: 'tollPaidBy' },
  { key: 'hasGps', example: 'yes' },
  { key: 'gpsProvider', example: 'Fleetx' },
  { key: 'gpsDeviceImei', example: '123456789012345' },
  { key: 'odometerKm', example: 84500 },
  { key: 'lastServiceDate', example: '2026-08-10' },
  { key: 'lastServiceOdometerKm', example: 80000 },
  { key: 'lastTyreChangeBrand', example: 'MRF' },
  { key: 'lastTyreChangeDate', example: '2026-05-01' },
  { key: 'serviceIntervalKm', example: 10000 },
  { key: 'serviceIntervalMonths', example: 6 },
  { key: 'tyrePreset', example: 'mostly_good' },
  { key: 'operationalStatus', example: 'idle' },
  { key: 'operationalStatusReason' },
  { key: 'rcNumber', example: 'RC123456' },
  { key: 'rcIssueDate', example: '2022-03-15' },
  { key: 'rcExpiryDate', example: '2037-03-14' },
  { key: 'insuranceNumber', example: 'POL-998877' },
  { key: 'insuranceProvider', example: 'ICICI Lombard' },
  { key: 'insuranceIssueDate', example: '2026-03-15' },
  { key: 'insuranceExpiryDate', example: '2027-03-14' },
  { key: 'permitNumber' },
  { key: 'permitIssueDate' },
  { key: 'permitExpiryDate' },
  { key: 'pucNumber' },
  { key: 'pucIssueDate' },
  { key: 'pucExpiryDate' },
  { key: 'fitnessNumber' },
  { key: 'fitnessIssueDate' },
  { key: 'fitnessExpiryDate' },
  { key: 'roadTaxNumber' },
  { key: 'roadTaxIssueDate' },
  { key: 'roadTaxExpiryDate' },
  { key: 'rcFrontUrl' },
  { key: 'rcBackUrl' },
  { key: 'driverId' },
  { key: 'driverIsPrimary' },
  { key: 'driverLinkedFrom' },
];

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** Normalized header → canonical column key. */
const KEY_BY_HEADER: Record<string, string> = Object.fromEntries(
  VEHICLE_IMPORT_COLUMNS.map(({ key }) => [normalizeHeader(key), key]),
);

const NUMERIC_KEYS = new Set([
  'wheelCount',
  'capacityTons',
  'grossVehicleWeightKg',
  'unladenWeightKg',
  'emiAmount',
  'emiMonthsLeft',
  'insurancePremiumYearly',
  'leaseRentMonthly',
  'odometerKm',
  'lastServiceOdometerKm',
  'serviceIntervalKm',
  'serviceIntervalMonths',
]);

const BOOLEAN_KEYS = new Set(['hasGps', 'driverIsPrimary']);

/** Enum-valued columns — "Mostly Good" / "flat-bed" are accepted as `mostly_good` / `flat_bed`. */
const ENUM_KEYS = new Set([
  'truckBody',
  'axleType',
  'fuelType',
  'ownershipType',
  'fuelPaidBy',
  'tollPaidBy',
  'tyrePreset',
  'operationalStatus',
]);

const DATED_DOCUMENTS = [
  { type: 'rc', prefix: 'rc' },
  { type: 'insurance', prefix: 'insurance' },
  { type: 'permit', prefix: 'permit' },
  { type: 'puc', prefix: 'puc' },
  { type: 'fitness', prefix: 'fitness' },
  { type: 'road_tax', prefix: 'roadTax' },
] as const;

function cell(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/** Unparseable text is passed through as-is so the zod schema reports it against the field. */
function parseValue(key: string, raw: string): unknown {
  if (NUMERIC_KEYS.has(key)) {
    const parsed = Number(raw.replace(/,/g, ''));
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (BOOLEAN_KEYS.has(key)) {
    const lowered = raw.toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(lowered)) return true;
    if (['no', 'n', 'false', '0'].includes(lowered)) return false;
    return raw;
  }
  if (ENUM_KEYS.has(key)) return raw.toLowerCase().replace(/[\s-]+/g, '_');
  return raw;
}

/** Drops undefined entries; an object with nothing left is `undefined` so its block is omitted. */
function compact<T extends Record<string, unknown>>(fields: T): Partial<T> | undefined {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

/** Folds one flat sheet row into the nested shape `vehicleValidators.onboardVehicle` expects. */
function buildOnboardBody(v: Record<string, unknown>): Record<string, unknown> {
  const documents = [
    ...DATED_DOCUMENTS.map(({ type, prefix }) =>
      compact({
        documentType: type,
        documentNumber: v[`${prefix}Number`],
        providerName: type === 'insurance' ? v.insuranceProvider : undefined,
        issueDate: v[`${prefix}IssueDate`],
        expiryDate: v[`${prefix}ExpiryDate`],
      }),
    ).filter((doc) => doc && Object.keys(doc).length > 1),
    v.rcFrontUrl ? { documentType: 'rc_front', fileUrl: v.rcFrontUrl } : undefined,
    v.rcBackUrl ? { documentType: 'rc_back', fileUrl: v.rcBackUrl } : undefined,
  ].filter(Boolean);

  const body: Partial<Record<keyof OnboardVehicleInput | 'truckType', unknown>> = {
    registrationNumber: v.registrationNumber,
    truckTypeId: v.truckTypeId,
    truckType: compact({
      body: v.truckBody,
      wheelCount: v.wheelCount,
      axleType: v.axleType,
      capacityTons: v.capacityTons,
      bodyLengthFt: v.bodyLengthFt,
    }),
    fuelType: v.fuelType,
    makeModel: v.makeModel,
    ownershipType: v.ownershipType,
    financierName: v.financierName,
    grossVehicleWeightKg: v.grossVehicleWeightKg,
    unladenWeightKg: v.unladenWeightKg,
    emissionNorm: v.emissionNorm,
    vahanBodyType: v.vahanBodyType,
    cost: compact({
      emiAmount: v.emiAmount,
      emiMonthsLeft: v.emiMonthsLeft,
      insurancePremiumYearly: v.insurancePremiumYearly,
      leaseRentMonthly: v.leaseRentMonthly,
      leaseEndDate: v.leaseEndDate,
      fuelPaidBy: v.fuelPaidBy,
      tollPaidBy: v.tollPaidBy,
    }),
    gps: compact({
      hasGps: v.hasGps,
      provider: v.gpsProvider,
      deviceImei: v.gpsDeviceImei,
    }),
    serviceUsage: compact({
      odometerKm: v.odometerKm,
      lastServiceDate: v.lastServiceDate,
      lastServiceOdometerKm: v.lastServiceOdometerKm,
      lastTyreChangeBrand: v.lastTyreChangeBrand,
      lastTyreChangeDate: v.lastTyreChangeDate,
      serviceIntervalKm: v.serviceIntervalKm,
      serviceIntervalMonths: v.serviceIntervalMonths,
    }),
    tyres: compact({ preset: v.tyrePreset }),
    operationalStatus: compact({
      operationalStatus: v.operationalStatus,
      reason: v.operationalStatusReason,
    }),
    documents: documents.length ? documents : undefined,
    driverLink: compact({
      driverId: v.driverId,
      isPrimary: v.driverIsPrimary,
      linkedFrom: v.driverLinkedFrom,
    }),
  };
  return compact(body) ?? {};
}

export async function parseVehicleExcel(buffer: Buffer): Promise<ParsedVehicleExcel> {
  const records = await parseSpreadsheetRows(buffer);

  if (!records.length)
    throw new Error('Excel file must contain a header and at least one data row');
  if (records.length > VEHICLE_IMPORT_MAX_ROWS)
    throw new Error(`Excel file cannot contain more than ${VEHICLE_IMPORT_MAX_ROWS} rows`);

  const mapping: Record<string, string> = {};
  for (const header of Object.keys(records[0])) {
    const key = KEY_BY_HEADER[normalizeHeader(header)];
    if (!key) throw new Error(`Unexpected column "${header}"`);
    if (Object.values(mapping).includes(key)) throw new Error(`Multiple columns map to "${key}"`);
    mapping[header] = key;
  }

  if (!Object.values(mapping).includes('registrationNumber'))
    throw new Error('Missing required column "registrationNumber"');

  const rows = records.map((record, index) => {
    const flat: Record<string, unknown> = {};
    for (const [header, key] of Object.entries(mapping)) {
      const raw = cell(record[header]);
      if (raw !== undefined) flat[key] = parseValue(key, raw);
    }
    return { row: index + 2, input: buildOnboardBody(flat) };
  });
  return { rows, mapping };
}
