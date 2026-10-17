import { ValidationError } from '../../shared/errors';
import { SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { AuditService } from '../audit/audit.service';
import {
  describeIssue,
  describeServiceError,
  labelFor,
} from '../masters/vehicle/vehicle-import.errors';
import { DriverService } from './driver.service';
import { DriverRepository } from './driver.repository';
import { DriverTenantRelationRepository } from './driver-tenant-relation.repository';
import { driverValidators } from './driver.validators';
import {
  DriverImportPreview,
  DriverImportPreviewRow,
  DriverImportReport,
  DriverImportResult,
  DriverImportRowError,
  OnboardDriverInput,
  ParsedDriverExcel,
} from './drivers.interface';
import { DriverImportErrorCode } from './drivers.types';
import { parseDriverExcel } from './driver-import.mapper';
import { DRIVER_IMPORT_BANK_COLUMN_BY_FIELD, DRIVER_IMPORT_CONCURRENCY } from './driver.constants';

/** Sheet column key a validator issue path points at (e.g. `bankDetails.ifsc` → `bankIfsc`). */
function columnKeyForPath(path: PropertyKey[]): string | undefined {
  const [head, field] = path.map(String);
  if (!head) return undefined;
  if (head === 'bankDetails') return field ? DRIVER_IMPORT_BANK_COLUMN_BY_FIELD[field] : undefined;
  if (head === 'operationalStatus')
    return field === 'reason' ? 'operationalStatusReason' : 'operationalStatus';
  return head;
}

/** Runs `task` over `items`, at most `limit` at a time, keeping results in input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sameName(a: string, b: string): boolean {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
  return normalise(a) === normalise(b);
}

/**
 * Bulk "Add a driver", in two steps so an admin sees the Sarathi results before anything is saved:
 * `preview` reads the .xlsx, validates every row and runs the licence lookup, saving nothing;
 * `import` saves the rows the admin approved, each through the same onboardDriver as the form.
 */
export class DriverImportService {
  constructor(
    private readonly drivers: DriverService,
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly audit: AuditService,
  ) {}

  async preview(tenantId: string, buffer: Buffer): Promise<DriverImportPreview> {
    const parsed = await this.parse(buffer);
    const headerByKey = new Map(
      Object.entries(parsed.mapping).map(([header, key]) => [key, header]),
    );
    const phones = new Map<string, number>();
    const licences = new Map<string, number>();

    // Validation and in-file duplicate checks first, in sheet order, so "already appears on row N"
    // always points at the earlier row.
    const checked = parsed.rows.map((item) => {
      const phoneNumber =
        typeof item.input.phoneNumber === 'string' ? item.input.phoneNumber : undefined;
      const rowError = (key: string, code: DriverImportErrorCode, message: string) => ({
        row: item.row,
        phoneNumber,
        column: headerByKey.get(key),
        field: key,
        code,
        message,
      });

      const result = driverValidators.onboardDriver.safeParse({ body: item.input });
      if (!result.success) {
        const errors = result.error.issues.map((issue) => {
          const path = issue.path.slice(1); // drop the leading "body"
          const key = columnKeyForPath(path);
          const { code, message } = describeIssue(issue, labelFor(key ?? path.join(' ')) || 'Row');
          return {
            row: item.row,
            phoneNumber,
            column: key ? (headerByKey.get(key) ?? key) : undefined,
            field: path.join('.') || undefined,
            code,
            message,
          };
        });
        return { item, errors };
      }

      const input = result.data.body as OnboardDriverInput;
      const errors: DriverImportRowError[] = [];
      const firstPhoneRow = phones.get(input.phoneNumber);
      if (firstPhoneRow !== undefined)
        errors.push(
          rowError(
            'phoneNumber',
            'duplicate_in_file',
            `Duplicate entry — ${input.phoneNumber} already appears on row ${firstPhoneRow}`,
          ),
        );
      else phones.set(input.phoneNumber, item.row);
      const firstLicenceRow = licences.get(input.licenseNumber);
      if (firstLicenceRow !== undefined)
        errors.push(
          rowError(
            'licenseNumber',
            'duplicate_in_file',
            `Duplicate entry — ${input.licenseNumber} already appears on row ${firstLicenceRow}`,
          ),
        );
      else licences.set(input.licenseNumber, item.row);
      return { item, errors, input, rowError };
    });

    const rows = await mapWithConcurrency(
      checked,
      DRIVER_IMPORT_CONCURRENCY,
      async ({ item, errors, input, rowError }): Promise<DriverImportPreviewRow> => {
        if (!input || !rowError || errors.length)
          return { row: item.row, status: 'invalid', warnings: [], errors };

        const warnings: string[] = [];
        // Same checks createDriver/findOrCreateDriverProfile make on save, run before the paid
        // lookup so a row that can never be saved doesn't cost one.
        const existingProfile = await this.driverRepository.findByPhoneNumber(input.phoneNumber);
        if (existingProfile) {
          const relation = await this.driverTenantRelationRepository.findByTenantAndDriver(
            tenantId,
            existingProfile.id,
          );
          if (relation)
            errors.push(
              rowError(
                'phoneNumber',
                'already_exists',
                'A driver with this phone number already exists',
              ),
            );
          else
            warnings.push(
              'This mobile number already has a Loadsmart driver profile — it will be linked as ' +
                'is, and the name and details in this row are not applied to it (the note is ' +
                'still saved for your fleet).',
            );
        } else if (await this.driverRepository.findByLicenseNumber(input.licenseNumber)) {
          errors.push(
            rowError(
              'licenseNumber',
              'already_exists',
              'A driver with this license number already exists',
            ),
          );
        }
        if (errors.length) return { row: item.row, status: 'invalid', warnings: [], errors };

        let lookup: SarathiDrivingLicenceResult;
        try {
          lookup = await this.drivers.checkDrivingLicenceForImport(
            tenantId,
            input.licenseNumber,
            input.dateOfBirth,
          );
        } catch (error) {
          const { code, message } = describeServiceError(error);
          return {
            row: item.row,
            status: 'invalid',
            warnings: [],
            errors: [rowError('licenseNumber', code, message)],
          };
        }

        // Mirrors onboardDriver: Sarathi's name wins over the sheet's.
        const fullName = lookup.holderName ?? input.fullName;
        if (!fullName && !existingProfile)
          return {
            row: item.row,
            status: 'invalid',
            warnings: [],
            errors: [
              rowError(
                'fullName',
                'missing_required',
                'Full name is required — the licence lookup did not return the holder name',
              ),
            ],
          };
        if (lookup.holderName && input.fullName && !sameName(lookup.holderName, input.fullName))
          warnings.push(
            `Name in the sheet ("${input.fullName}") differs from Sarathi ("${lookup.holderName}") — ` +
              'the Sarathi name will be saved.',
          );
        if (lookup.validUntil && lookup.validUntil < new Date().toISOString().slice(0, 10))
          warnings.push(`Driving licence expired on ${lookup.validUntil}.`);

        return {
          row: item.row,
          status: lookup.status === 'manual_review' ? 'needs_review' : 'ready',
          data: { ...input, fullName },
          licenceCheck: {
            status: lookup.status,
            holderName: lookup.holderName,
            validUntil: lookup.validUntil,
            licenseClass: lookup.licenseClass,
            transportClass: lookup.transportClass,
            licenseStatus: lookup.licenseStatus,
            age: lookup.age,
          },
          warnings,
          errors: [],
        };
      },
    );

    return {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.status === 'ready').length,
      needsReviewRows: rows.filter((row) => row.status === 'needs_review').length,
      invalidRows: rows.filter((row) => row.status === 'invalid').length,
      columnMapping: parsed.mapping,
      rows,
    };
  }

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    drivers: OnboardDriverInput[],
  ): Promise<DriverImportReport> {
    // Two rows for the same person would race each other into createDriver — fail the later one
    // up front instead, the same way the preview flags it.
    const seen = new Map<string, number>();
    const duplicateOf = drivers.map((driver, index) => {
      const earlier = seen.get(driver.phoneNumber) ?? seen.get(driver.licenseNumber);
      seen.set(driver.phoneNumber, seen.get(driver.phoneNumber) ?? index);
      seen.set(driver.licenseNumber, seen.get(driver.licenseNumber) ?? index);
      return earlier;
    });

    // One transaction per driver (inside onboardDriver) — a bad row never blocks the others.
    const results = await mapWithConcurrency(
      drivers,
      DRIVER_IMPORT_CONCURRENCY,
      async (driver, index): Promise<DriverImportResult> => {
        const base = { index, phoneNumber: driver.phoneNumber };
        const earlier = duplicateOf[index];
        if (earlier !== undefined)
          return {
            ...base,
            status: 'failed',
            code: 'duplicate_in_file',
            message: `Duplicate entry — same driver as drivers[${earlier}]`,
          };
        try {
          const created = await this.drivers.onboardDriver(tenantId, actorId, role, driver);
          return { ...base, status: 'created', driverId: created.id };
        } catch (error) {
          return { ...base, status: 'failed', ...describeServiceError(error) };
        }
      },
    );

    const report: DriverImportReport = {
      total: results.length,
      created: results.filter((result) => result.status === 'created').length,
      failed: results.filter((result) => result.status === 'failed').length,
      results,
    };

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'DRIVER_BULK_IMPORTED',
      resourceType: 'driver',
      newData: { ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedDriverExcel> {
    try {
      return await parseDriverExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
