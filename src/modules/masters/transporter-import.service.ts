import { ValidationError } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { mastersValidators } from './masters.validators';
import { TransporterService } from './transporter.service';
import { CreateTransporterInput } from './utils/transporter.interface';
import { parseTransporterExcel, ParsedTransporterExcel } from './transporter-import.mapper';

export interface TransporterImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface TransporterImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: TransporterImportRowError[];
}

export class TransporterImportService {
  constructor(
    private readonly transporters: TransporterService,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<TransporterImportReport> {
    const parsed = await this.parse(buffer);
    const valid: { row: number; input: CreateTransporterInput }[] = [];
    const errors: TransporterImportRowError[] = [];
    const phones = new Set<string>();

    for (const item of parsed.rows) {
      const result = mastersValidators.createTransporter.safeParse({ body: item.input });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ row: item.row, field: issue.path[1]?.toString(), message: issue.message });
        }
        continue;
      }
      const input = result.data.body as CreateTransporterInput;
      if (phones.has(input.phone)) {
        errors.push({
          row: item.row,
          field: 'phone',
          message: 'Duplicate transporter phone in this file',
        });
        continue;
      }
      phones.add(input.phone);
      valid.push({ row: item.row, input });
    }

    const report: TransporterImportReport = {
      totalRows: parsed.rows.length,
      validRows: valid.length,
      created: 0,
      skipped: 0,
      failed: errors.length,
      columnMapping: parsed.mapping,
      errors,
    };

    for (const item of valid) {
      try {
        await this.transporters.create(tenantId, actorId, role, item.input);
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          field: 'phone',
          message: error instanceof Error ? error.message : 'Failed to create transporter',
        });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'TRANSPORTER_BULK_IMPORTED',
      resourceType: 'transporter',
      newData: { fileName, ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedTransporterExcel> {
    try {
      return await parseTransporterExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
