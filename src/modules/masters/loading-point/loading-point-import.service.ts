import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { loadingPointValidators } from './loading-point.validators';
import { LoadingPointService } from './loading-point.service';
import { CreateLoadingPointInput } from './loading-point.interface';
import { parseLoadingPointExcel, ParsedLoadingPointExcel } from './loading-point-import.mapper';

export interface LoadingPointImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface LoadingPointImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: LoadingPointImportRowError[];
}

export class LoadingPointImportService {
  constructor(
    private readonly loadingPoints: LoadingPointService,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    actorRole: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<LoadingPointImportReport> {
    const parsed = await this.parse(buffer);
    const valid: { row: number; input: CreateLoadingPointInput }[] = [];
    const errors: LoadingPointImportRowError[] = [];

    for (const item of parsed.rows) {
      const result = loadingPointValidators.create.safeParse({ body: item.input });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ row: item.row, field: issue.path[1]?.toString(), message: issue.message });
        }
        continue;
      }
      valid.push({ row: item.row, input: result.data.body as CreateLoadingPointInput });
    }

    const report: LoadingPointImportReport = {
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
        await this.loadingPoints.create(tenantId, actorId, actorRole, item.input);
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          message: error instanceof Error ? error.message : 'Failed to create loading point',
        });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'LOADING_POINT_BULK_IMPORTED',
      resourceType: 'loading_point',
      newData: { fileName, ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedLoadingPointExcel> {
    try {
      return await parseLoadingPointExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
