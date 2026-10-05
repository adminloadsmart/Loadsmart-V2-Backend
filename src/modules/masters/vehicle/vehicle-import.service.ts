import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { VehicleService } from './vehicle.service';
import { vehicleValidators } from './vehicle.validators';
import { OnboardVehicleInput } from './vehicle.interface';
import { parseVehicleExcel, ParsedVehicleExcel } from './vehicle-import.mapper';

export interface VehicleImportRowError {
  row: number;
  field?: string;
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
    const registrations = new Set<string>();

    for (const item of parsed.rows) {
      const result = vehicleValidators.onboardVehicle.safeParse({ body: item.input });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            row: item.row,
            field: issue.path.slice(1).join('.') || undefined,
            message: issue.message,
          });
        }
        continue;
      }
      const input = result.data.body as OnboardVehicleInput;
      if (registrations.has(input.registrationNumber)) {
        errors.push({
          row: item.row,
          field: 'registrationNumber',
          message: 'Duplicate registration number in this file',
        });
        continue;
      }
      registrations.add(input.registrationNumber);
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
          field: 'registrationNumber',
          message: error instanceof Error ? error.message : 'Failed to onboard vehicle',
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
