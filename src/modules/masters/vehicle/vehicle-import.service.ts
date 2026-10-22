import { ValidationError } from '../../../shared/errors';
import { ImportSource } from '../../../shared/import/upload';
import { AuditService } from '../../audit/audit.service';
import { DriverTenantRelationRepository } from '../../driver/driver-tenant-relation.repository';
import { VehicleService } from './vehicle.service';
import { vehicleValidators } from './vehicle.validators';
import { OnboardVehicleInput } from './vehicle.interface';
import { VehicleRepository } from './vehicle.repository';
import { parseVehicleSheet, ParsedVehicleSheet, VehicleImportDraft } from './vehicle-import.mapper';
import { IMPORT_COLUMNS } from './vehicle-import.columns';
import { VehicleVahanVerificationService } from './vehicle-vahan-verification.service';
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
  /** Rows with at least one error — every error is listed in `errors`. */
  failed: number;
  /** Created trucks queued for the background VAHAN check. */
  vahanVerificationQueued: number;
  columnMapping: Record<string, string>;
  /** Sheet headers the import didn't recognise (skipped). */
  ignoredColumns: string[];
  errors: VehicleImportRowError[];
}

/** Template header per column key — the label errors use when the sheet named it differently. */
const TEMPLATE_HEADER_BY_KEY = new Map(IMPORT_COLUMNS.map((column) => [column.key, column.header]));

/**
 * Fleet → Bulk Upload. Rows are validated like POST /masters/vehicles/onboard, deduped on
 * registration number (in the file and against the fleet), linked to a driver by phone, and
 * onboarded one by one (one transaction each) so a bad row never stops the rest. Every created
 * truck gets a 'pending' VAHAN snapshot and a 'vahan-verification' job.
 */
export class VehicleImportService {
  constructor(
    private readonly vehicles: VehicleService,
    private readonly repository: Pick<VehicleRepository, 'findByRegistrationNumber'>,
    private readonly drivers: Pick<DriverTenantRelationRepository, 'findActiveDriverByPhone'>,
    private readonly audit: AuditService,
    private readonly vahanVerification: Pick<VehicleVahanVerificationService, 'enqueue'>,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    source: ImportSource,
  ): Promise<VehicleImportReport> {
    const parsed = await this.parse(source);
    const valid: { row: number; input: OnboardVehicleInput }[] = [];
    const errors: VehicleImportRowError[] = [];
    const registrations = new Map<string, number>();
    const sheetHeaderByKey = new Map(
      Object.entries(parsed.mapping).map(([header, key]) => [key, header]),
    );
    const columnFor = (key: string | undefined) =>
      key ? (sheetHeaderByKey.get(key) ?? TEMPLATE_HEADER_BY_KEY.get(key) ?? key) : undefined;
    const driverByPhone = this.driverResolver(tenantId);

    for (const item of parsed.rows) {
      const { driverPhone, ...body } = item.input as VehicleImportDraft;
      const plate =
        typeof body.registrationNumber === 'string' ? body.registrationNumber : undefined;
      const rowError = (key: string | undefined, code: VehicleImportErrorCode, message: string) =>
        errors.push({
          row: item.row,
          registrationNumber: plate,
          column: columnFor(key),
          field: key,
          code,
          message,
        });

      if (driverPhone) {
        const driver = await driverByPhone(driverPhone);
        if (!driver) {
          rowError('driverPhone', 'not_found', `No active driver with phone ${driverPhone}`);
          continue;
        }
        body.driverLink = { ...(body.driverLink as object), driverId: driver.id };
      }

      const result = vehicleValidators.onboardVehicle.safeParse({ body });
      if (!result.success) {
        const documents = body.documents as { documentType?: string }[] | undefined;
        for (const issue of result.error.issues) {
          const path = issue.path.slice(1); // drop the leading "body"
          const key = columnKeyForPath(path, documents);
          const label = (key && TEMPLATE_HEADER_BY_KEY.get(key)) ?? labelFor(key ?? path.join(' '));
          const { code, message } = describeIssue(issue, label || 'Row');
          errors.push({
            row: item.row,
            registrationNumber: plate,
            column: columnFor(key),
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
        rowError(
          'registrationNumber',
          'duplicate_in_file',
          `Duplicate entry — ${input.registrationNumber} already appears on row ${firstRow}`,
        );
        continue;
      }
      registrations.set(input.registrationNumber, item.row);
      if (await this.repository.findByRegistrationNumber(tenantId, input.registrationNumber)) {
        rowError(
          'registrationNumber',
          'already_exists',
          `A vehicle with registration number ${input.registrationNumber} already exists`,
        );
        continue;
      }
      valid.push({ row: item.row, input });
    }

    const report: VehicleImportReport = {
      totalRows: parsed.rows.length,
      validRows: valid.length,
      created: 0,
      skipped: 0,
      failed: 0,
      vahanVerificationQueued: 0,
      columnMapping: parsed.mapping,
      ignoredColumns: parsed.ignoredColumns,
      errors,
    };

    // One transaction per vehicle (inside onboardVehicle) — a bad row never blocks the others.
    for (const item of valid) {
      let vehicleId: string;
      try {
        const vehicle = await this.vehicles.onboardVehicle(tenantId, actorId, role, item.input, {
          queueVahanVerification: true,
        });
        vehicleId = vehicle.id;
        report.created += 1;
      } catch (error) {
        errors.push({
          row: item.row,
          registrationNumber: item.input.registrationNumber,
          field: 'registrationNumber',
          ...describeServiceError(error),
        });
        continue;
      }
      if (await this.vahanVerification.enqueue({ tenantId, recordId: vehicleId, actorId }))
        report.vahanVerificationQueued += 1;
    }
    errors.sort((a, b) => a.row - b.row);
    report.failed = new Set(errors.map((error) => error.row)).size;

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'VEHICLE_BULK_IMPORTED',
      resourceType: 'vehicle',
      newData: {
        fileName: source.fileName,
        totalRows: report.totalRows,
        created: report.created,
        failed: report.failed,
        vahanVerificationQueued: report.vahanVerificationQueued,
      },
    });
    return report;
  }

  /** Phone → active driver of this tenant, cached per import. */
  private driverResolver(tenantId: string) {
    const cache = new Map<string, ReturnType<typeof this.drivers.findActiveDriverByPhone>>();
    return (phone: string) => {
      let found = cache.get(phone);
      if (!found) {
        found = this.drivers.findActiveDriverByPhone(tenantId, phone);
        cache.set(phone, found);
      }
      return found;
    };
  }

  private async parse(source: ImportSource): Promise<ParsedVehicleSheet> {
    try {
      return await parseVehicleSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
