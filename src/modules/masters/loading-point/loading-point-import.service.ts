import { ValidationError } from '../../../shared/errors';
import { ImportReport } from '../../../shared/import/report';
import { importRows } from '../../../shared/import/run';
import { ImportSource } from '../../../shared/import/upload';
import { AuditService } from '../../audit/audit.service';
import { loadingPointValidators } from './loading-point.validators';
import { LoadingPointService } from './loading-point.service';
import { CreateLoadingPointInput } from './loading-point.interface';
import { LoadingPointRepository } from './loading-point.repository';
import { parseLoadingPointSheet, ParsedLoadingPointSheet } from './loading-point-import.mapper';
import { IMPORT_COLUMNS } from './loading-point-import.columns';

const naturalKey = (input: CreateLoadingPointInput) =>
  `${input.title.trim().toLowerCase()}|${input.pinCode.trim()}`;

/** Settings → Loading Points "Bulk Upload": rows validated like POST /masters/loading-points,
 *  deduped on Title + PIN (in the file and against existing points), created one by one. */
export class LoadingPointImportService {
  constructor(
    private readonly loadingPoints: LoadingPointService,
    private readonly repository: Pick<LoadingPointRepository, 'findByTitleAndPin'>,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    actorRole: string,
    source: ImportSource,
  ): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const report = await importRows(parsed, {
      columns: IMPORT_COLUMNS,
      schema: loadingPointValidators.create.shape.body,
      duplicateKey: naturalKey,
      duplicateError: {
        field: 'Title',
        message: 'Duplicate Title + PIN — already used by an earlier row in this file',
      },
      check: async (input) =>
        (await this.repository.findByTitleAndPin(tenantId, input.title, input.pinCode))
          ? {
              field: 'Title',
              message: `A loading point "${input.title}" with PIN ${input.pinCode} already exists`,
            }
          : null,
      create: (input) => this.loadingPoints.create(tenantId, actorId, actorRole, input),
    });

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'LOADING_POINT_BULK_IMPORTED',
      resourceType: 'loading_point',
      newData: {
        fileName: source.fileName,
        totalRows: report.total,
        created: report.created,
        failed: report.failed,
      },
    });
    return report;
  }

  private async parse(source: ImportSource): Promise<ParsedLoadingPointSheet> {
    try {
      return await parseLoadingPointSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
