import { Workbook } from 'exceljs';
import { toIstDateString } from '../../../shared/utils/ist-time';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import { VEHICLE_IMPORT_COLUMNS } from './vehicle-import.mapper';

export const VEHICLE_EXPORT_MAX_ROWS = 5000;

type Cell = string | number;

const DATED_DOCUMENTS = [
  { type: 'rc', prefix: 'rc' },
  { type: 'insurance', prefix: 'insurance' },
  { type: 'permit', prefix: 'permit' },
  { type: 'puc', prefix: 'puc' },
  { type: 'fitness', prefix: 'fitness' },
  { type: 'road_tax', prefix: 'roadTax' },
] as const;

/** numeric/decimal columns come back from pg as strings. */
function num(value: string | number | null | undefined): Cell | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/** Whole months from today up to `endDate`, rounded up — the inverse of the import's
 *  "months left" → EMI end date. Past or missing dates give nothing. */
function monthsLeft(endDate: string | null | undefined): number | undefined {
  if (!endDate) return undefined;
  const [ty, tm, td] = toIstDateString(new Date()).split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const months = (ey - ty) * 12 + (em - tm) + (ed > td ? 1 : 0);
  return months > 0 ? months : undefined;
}

function yesNo(value: boolean | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value ? 'yes' : 'no';
}

/**
 * One vehicle → one row keyed by the import's column names, so an export can be edited and
 * uploaded straight back. Needs documents, driverLinks, truckType, telemetryMeta, serviceUsage and
 * operationalStatus loaded. A picker-made truck (open/closed body) is written as its picker
 * columns, anything else as `truckTypeId` — the import accepts exactly one of the two.
 */
export function vehicleToExportRow(vehicle: VehicleEntity): Record<string, Cell | undefined> {
  const meta = vehicle.telemetryMeta;
  const usage = vehicle.serviceUsage;
  const documents: VehicleDocumentEntity[] = (vehicle.documents ?? []).filter((d) => !d.deletedAt);
  const documentOf = (type: string) => documents.find((d) => d.documentType === type);
  const primaryLink = (vehicle.driverLinks ?? []).find(
    (link) => link.status === 'active' && link.isPrimary && !link.deletedAt,
  );
  const fromPicker = vehicle.bodyType === 'open' || vehicle.bodyType === 'closed';

  const row: Record<string, Cell | undefined> = {
    registrationNumber: vehicle.registrationNumber,
    truckTypeId: fromPicker ? undefined : (vehicle.truckTypeId ?? undefined),
    truckBody: fromPicker ? (vehicle.bodyType ?? undefined) : undefined,
    wheelCount: fromPicker && !vehicle.axleType ? (vehicle.wheelCount ?? undefined) : undefined,
    axleType: fromPicker ? (vehicle.axleType ?? undefined) : undefined,
    capacityTons: fromPicker ? num(vehicle.capacityTons) : undefined,
    bodyLengthFt: fromPicker ? (vehicle.bodyLengthFt ?? undefined) : undefined,
    fuelType: vehicle.fuelType ?? undefined,
    makeModel: vehicle.makeModel ?? undefined,
    ownershipType: vehicle.ownershipType,
    financierName: vehicle.financierName ?? undefined,
    grossVehicleWeightKg: vehicle.grossVehicleWeightKg ?? undefined,
    unladenWeightKg: vehicle.unladenWeightKg ?? undefined,
    emissionNorm: vehicle.emissionNorm ?? undefined,
    vahanBodyType: vehicle.vahanBodyType ?? undefined,
    emiAmount: num(meta?.emiAmount),
    emiMonthsLeft: monthsLeft(meta?.emiEndDate),
    insurancePremiumYearly: num(meta?.insurancePremiumYearly),
    leaseRentMonthly: num(meta?.leaseRentMonthly),
    leaseEndDate: meta?.leaseEndDate ?? undefined,
    fuelPaidBy: meta?.fuelPaidBy ?? undefined,
    tollPaidBy: meta?.tollPaidBy ?? undefined,
    hasGps: yesNo(meta?.hasGps),
    gpsProvider: meta?.gpsProvider ?? undefined,
    gpsDeviceImei: meta?.gpsDeviceImei ?? undefined,
    odometerKm: usage?.odometerKm ?? undefined,
    lastServiceDate: usage?.lastServiceDate ?? undefined,
    lastServiceOdometerKm: usage?.lastServiceOdometerKm ?? undefined,
    lastTyreChangeBrand: usage?.lastTyreChangeBrand ?? undefined,
    lastTyreChangeDate: usage?.lastTyreChangeDate ?? undefined,
    serviceIntervalKm: usage?.serviceIntervalKm ?? undefined,
    serviceIntervalMonths: usage?.serviceIntervalMonths ?? undefined,
    operationalStatus: vehicle.operationalStatus?.operationalStatus,
    operationalStatusReason: vehicle.operationalStatus?.reason ?? undefined,
    rcFrontUrl: documentOf('rc_front')?.fileUrl ?? undefined,
    rcBackUrl: documentOf('rc_back')?.fileUrl ?? undefined,
    driverId: primaryLink?.driverId,
    driverIsPrimary: primaryLink ? 'yes' : undefined,
    driverLinkedFrom: primaryLink?.linkedFrom,
  };

  for (const { type, prefix } of DATED_DOCUMENTS) {
    const document = documentOf(type);
    row[`${prefix}Number`] = document?.documentNumber ?? undefined;
    row[`${prefix}IssueDate`] = document?.issueDate ?? undefined;
    row[`${prefix}ExpiryDate`] = document?.expiryDate ?? undefined;
  }
  row.insuranceProvider = documentOf('insurance')?.providerName ?? undefined;
  return row;
}

export async function buildVehicleWorkbook(vehicles: VehicleEntity[]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Vehicles');
  sheet.addRow(VEHICLE_IMPORT_COLUMNS.map(({ key }) => key)).font = { bold: true };
  for (const vehicle of vehicles) {
    const row = vehicleToExportRow(vehicle);
    sheet.addRow(VEHICLE_IMPORT_COLUMNS.map(({ key }) => row[key] ?? ''));
  }
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
