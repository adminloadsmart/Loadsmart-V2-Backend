import { Workbook } from 'exceljs';
import { DriverExportColumnKey, DriverRosterRow } from './drivers.interface';
import {
  DRIVER_ENGAGEMENT_TYPE_LABELS,
  DRIVER_EXPORT_AVAILABILITY_LABELS,
  DRIVER_EXPORT_BOOLEAN_LABELS,
  DRIVER_EXPORT_COLUMNS,
  DRIVER_EXPORT_NOT_CHECKED,
  DRIVER_LICENSE_ENDORSEMENT_LABELS,
  DRIVER_SALARY_TYPE_LABELS,
  DRIVER_SCORE_STATUS_LABELS,
  DRIVER_VERIFICATION_STATUS_LABELS,
} from './driver.constants';
import { toDateString } from '../../shared/utils/date';

type Cell = string | number;

/** numeric/decimal columns come back from pg as strings. */
function num(value: string | number | null | undefined): Cell | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

const yesNo = (value: boolean): string => DRIVER_EXPORT_BOOLEAN_LABELS[`${value}`];

/** Dates as the sheet's other date columns write them (YYYY-MM-DD). */
function dateCell(value: Date | string | null | undefined): Cell | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : toDateString(value);
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

/** One roster row → one sheet row keyed by DRIVER_EXPORT_COLUMNS — every card of the driver
 *  detail screen (licence credentials, contact & engagement, assignment, availability,
 *  performance) plus the profile fields behind it. */
export function driverToExportRow(
  row: DriverRosterRow,
): Record<DriverExportColumnKey, Cell | undefined> {
  const { licence, contact, assignment, availability, performance } = row;
  return {
    fullName: row.fullName,
    // Stored as digits, sometimes with the 91 country code — the sheet shows the 10-digit number.
    mobileNumber: row.phoneNumber.slice(-10),
    dateOfBirth: dateCell(row.dateOfBirth),
    address: [row.addressLine1, row.addressLine2].filter(Boolean).join(', ') || undefined,
    city: row.city ?? undefined,
    pinCode: row.pinCode ?? undefined,

    licenceNumber: licence.number ?? undefined,
    licenceClass: licence.classOfVehicle ?? undefined,
    licenceEndorsements:
      licence.endorsements.map((code) => DRIVER_LICENSE_ENDORSEMENT_LABELS[code]).join(', ') ||
      undefined,
    licenceValidTo: dateCell(licence.validTo),
    licenceDaysLeft: licence.daysLeft ?? undefined,
    sarathiVerification: licence.registry
      ? DRIVER_VERIFICATION_STATUS_LABELS[licence.registry.status]
      : DRIVER_EXPORT_NOT_CHECKED,
    sarathiCheckedOn: dateCell(licence.registry?.checkedAt),
    eligibleToDrive: yesNo(licence.eligibleToDrive),

    bloodGroup: contact.bloodGroup ?? undefined,
    emergencyContactName: contact.emergencyContact?.name ?? undefined,
    emergencyContactPhone: contact.emergencyContact?.phone,
    emergencyContactRelation: contact.emergencyContact?.relation ?? undefined,
    engagementType: contact.engagementType
      ? DRIVER_ENGAGEMENT_TYPE_LABELS[contact.engagementType]
      : undefined,
    dateOfJoining: dateCell(contact.dateOfJoining),
    tenureYears: contact.tenureYears ?? undefined,
    payType: contact.compensation.salaryType
      ? DRIVER_SALARY_TYPE_LABELS[contact.compensation.salaryType]
      : undefined,
    payAmount: num(contact.compensation.salaryAmount),
    bhattaPerDay: num(contact.compensation.bhattaPerDay),
    advanceOutstanding: num(contact.advanceOutstanding),

    assignedVehicle: assignment.vehicle?.registrationNumber,
    truckType: assignment.vehicle?.truckType?.name,
    homeBase: assignment.homeBase ?? undefined,

    availability: availabilityLabel(row),
    availabilityReason: row.operationalStatus?.reason ?? undefined,
    currentLoad: availability.activeLoad?.code,

    trips: performance.totalTrips,
    onTimePercentage: performance.onTimePercentage ?? undefined,
    driverScore: driverScoreCell(row),

    driverAppInstalled: yesNo(row.appInstalled),
    appLastSeen: dateCell(row.appLastSeenAt),
    note: row.note ?? undefined,
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
