import { IMPORT_MAX_ROWS } from '../../../shared/import/upload';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../../shared/import/parse';
import { buildImportSample } from '../../../shared/import/sample';
import { IMPORT_COLUMNS, TEMPLATE_COLUMNS } from './vehicle-import.columns';

/** A mapped sheet row: the onboard body, plus `driverPhone` until the import resolves it. */
export type VehicleImportDraft = Record<string, unknown> & { driverPhone?: string };
export type ParsedVehicleSheet = ParsedImportSheet<VehicleImportDraft>;

export const VEHICLE_IMPORT_SAMPLE_FILENAME = 'vehicle-bulk-upload-template.xlsx';

/** Reads a Fleet upload into POST /masters/vehicles/onboard bodies (truckType, cost, gps,
 *  serviceUsage, tyres, operationalStatus, documents and driverLink folded from flat columns). */
export function parseVehicleSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedVehicleSheet> {
  return parseImportSheet<VehicleImportDraft>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [['registrationNumber']],
  });
}

export function buildVehicleImportSample(): Promise<Buffer> {
  return buildImportSample({
    sheetName: 'Trucks',
    columns: TEMPLATE_COLUMNS,
    notes: [
      'Registration Number must be unique — a plate repeated in the file, or already in your fleet, is reported and skipped.',
      'Truck type: Truck Body, Capacity, Body Length and Wheels (or Axle Type for 32 ft containers) must match a truck type the Add a truck picker offers.',
      'Cost: EMI and Insurance Premium are for owned / financed trucks; Lease Rent, Lease End Date, Fuel and Toll Paid By are for attached trucks only. Attached trucks take no service or tyre columns.',
      "Papers: fill a paper's Number and/or dates; leave all its columns blank to skip it. Upload the photos in the app.",
      'Driver Phone links an active driver from your Drivers roster to the truck.',
      'Every truck is checked against VAHAN in the background (one lookup every 2 minutes) and shows VAHAN Pending until then. A verified result fills the paper expiry dates and any blank vehicle details.',
    ],
  });
}
