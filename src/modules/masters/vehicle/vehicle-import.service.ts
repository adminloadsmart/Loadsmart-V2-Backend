import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { VehicleService } from './vehicle.service';
import { vehicleValidators } from './vehicle.validators';
import { OnboardVehicleInput } from './vehicle.interface';
import { parseVehicleExcel, ParsedVehicleExcel } from './vehicle-import.mapper';
import {
  columnKeyForPath,
  describeIssue,
  describeServiceError,
  labelFor,
  VehicleImportErrorCode,
} from './vehicle-import.errors';

export interface VehicleImportRowError {
  row: number;
  /** The plate as typed in the sheet, so the row is identifiable without counting lines. */
  registrationNumber?: string;
  /** Sheet column header the problem is in, when it maps to one. */
  column?: string;
  field?: string;
  code: VehicleImportErrorCode;
  message: string;
}

export interface VehicleImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: VehicleImportRowError[];
}

export class VehicleImportService {
  constructor(
    private readonly vehicles: VehicleService,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<VehicleImportReport> {
    const parsed = await this.parse(buffer);
    const valid: { row: number; input: OnboardVehicleInput }[] = [];
    const errors: VehicleImportRowError[] = [];
    const registrations = new Map<string, number>();
    const headerByKey = new Map(
      Object.entries(parsed.mapping).map(([header, key]) => [key, header]),
    );

    for (const item of parsed.rows) {
      const result = vehicleValidators.onboardVehicle.safeParse({ body: item.input });
      const plate =
        typeof item.input.registrationNumber === 'string'
          ? item.input.registrationNumber
          : undefined;
      if (!result.success) {
        const documents = item.input.documents as { documentType?: string }[] | undefined;
        for (const issue of result.error.issues) {
          const path = issue.path.slice(1); // drop the leading "body"
          const key = columnKeyForPath(path, documents);
          const column = key ? (headerByKey.get(key) ?? key) : undefined;
          const { code, message } = describeIssue(issue, labelFor(key ?? path.join(' ')) || 'Row');
          errors.push({
            row: item.row,
            registrationNumber: plate,
            column,
            field: path.join('.') || undefined,
            code,
            message,
          });
        }
        continue;
      }
      const input = result.data.body as OnboardVehicleInput;
      const firstRow = registrations.get(input.registrationNumber);
      if (firstRow !== undefined) {
        errors.push({
          row: item.row,
          registrationNumber: input.registrationNumber,
          column: headerByKey.get('registrationNumber'),
          field: 'registrationNumber',
          code: 'duplicate_in_file',
          message: `Duplicate entry — ${input.registrationNumber} already appears on row ${firstRow}`,
        });
        continue;
      }
      registrations.set(input.registrationNumber, item.row);
      valid.push({ row: item.row, input });
    }

    const report: VehicleImportReport = {
      totalRows: parsed.rows.length,
      validRows: valid.length,
      created: 0,
      skipped: 0,
      failed: errors.length,
      columnMapping: parsed.mapping,
      errors,
    };

    // One transaction per vehicle (inside onboardVehicle) — a bad row never blocks the others.
    for (const item of valid) {
      try {
        await this.vehicles.onboardVehicle(tenantId, actorId, role, item.input);
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          registrationNumber: item.input.registrationNumber,
          field: 'registrationNumber',
          ...describeServiceError(error),
        });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'VEHICLE_BULK_IMPORTED',
      resourceType: 'vehicle',
      newData: { fileName, ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedVehicleExcel> {
    try {
      return await parseVehicleExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
