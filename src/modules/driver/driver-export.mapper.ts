import { Workbook } from 'exceljs';
import { DriverExportColumnKey, DriverRosterRow } from './drivers.interface';
import {
  DRIVER_ENGAGEMENT_TYPE_LABELS,
  DRIVER_EXPORT_AVAILABILITY_LABELS,
  DRIVER_EXPORT_COLUMNS,
  DRIVER_SALARY_TYPE_LABELS,
  DRIVER_SCORE_STATUS_LABELS,
} from './driver.constants';

type Cell = string | number;

/** numeric/decimal columns come back from pg as strings. */
function num(value: string | number | null | undefined): Cell | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/** The roster's availability, in the same order its tabs decide it: left the company first, then
 *  a live load, then leave / medically unfit. */
function availabilityLabel(row: DriverRosterRow): string {
  const operationalStatus = row.operationalStatus?.operationalStatus;
  if (operationalStatus === 'inactive') return DRIVER_EXPORT_AVAILABILITY_LABELS.left_company;
  if (row.availability.activeLoad) return DRIVER_EXPORT_AVAILABILITY_LABELS.on_trip;
  if (operationalStatus === 'on_leave' || operationalStatus === 'medically_unfit') {
    return DRIVER_EXPORT_AVAILABILITY_LABELS.not_available;
  }
  return DRIVER_EXPORT_AVAILABILITY_LABELS.available;
}

/** "New" until a real score exists — the same badge the roster shows. */
function driverScoreCell(row: DriverRosterRow): Cell {
  const { driverScore, scoreStatus } = row.performance;
  return driverScore ?? DRIVER_SCORE_STATUS_LABELS[scoreStatus];
}

/** One roster row → one sheet row keyed by DRIVER_EXPORT_COLUMNS. */
export function driverToExportRow(
  row: DriverRosterRow,
): Record<DriverExportColumnKey, Cell | undefined> {
  return {
    fullName: row.fullName,
    // Stored as digits, sometimes with the 91 country code — the sheet shows the 10-digit number.
    mobileNumber: row.phoneNumber.slice(-10),
    licenceNumber: row.licence.number ?? undefined,
    licenceClass: row.licence.classOfVehicle ?? undefined,
    licenceValidTo: row.licence.validTo ?? undefined,
    engagementType: row.engagementType
      ? DRIVER_ENGAGEMENT_TYPE_LABELS[row.engagementType]
      : undefined,
    payType: row.salaryType ? DRIVER_SALARY_TYPE_LABELS[row.salaryType] : undefined,
    payAmount: num(row.salaryAmount),
    trips: row.performance.totalTrips,
    onTimePercentage: row.performance.onTimePercentage ?? undefined,
    driverScore: driverScoreCell(row),
    availability: availabilityLabel(row),
    driverAppInstalled: row.appInstalled ? 'Yes' : 'No',
  };
}

export async function buildDriverWorkbook(rows: DriverRosterRow[]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Drivers');
  sheet.addRow(DRIVER_EXPORT_COLUMNS.map(({ header }) => header)).font = { bold: true };
  for (const row of rows) {
    const cells = driverToExportRow(row);
    sheet.addRow(DRIVER_EXPORT_COLUMNS.map(({ key }) => cells[key] ?? ''));
  }
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
