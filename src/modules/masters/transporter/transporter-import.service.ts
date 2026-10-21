import { ValidationError } from '../../../shared/errors';
import {
  finishReport,
  ImportReport,
  ImportRowError,
  rowErrors,
  startReport,
} from '../../../shared/import/report';
import { ImportSource } from '../../../shared/import/upload';
import { AuditService } from '../../audit/audit.service';
import { transporterValidators } from './transporter.validators';
import { TransporterService } from './transporter.service';
import { CreateTransporterInput } from './transporter.interface';
import { TransporterRepository } from './transporter.repository';
import { parseTransporterSheet, ParsedTransporterSheet } from './transporter-import.mapper';
import { IMPORT_COLUMNS } from './transporter-import.columns';
import { TransporterGstVerificationService } from './transporter-gst-verification.service';

/** Settings → Transporters "Bulk Upload". Rows are validated like POST /masters/transporters,
 *  deduped on phone (in the file and against existing transporters) and created one by one, so a
 *  bad row never stops the rest. GSTIN rows are queued for background GST verification. */
export class TransporterImportService {
  constructor(
    private readonly transporters: TransporterService,
    private readonly repository: Pick<TransporterRepository, 'findByPhone'>,
    private readonly audit: AuditService,
    private readonly gstVerification: TransporterGstVerificationService,
  ) {}

  private async inspect(parsed: ParsedTransporterSheet, tenantId: string) {
    const valid: { row: number; input: CreateTransporterInput }[] = [];
    const errors: ImportRowError[] = [];
    const phones = new Set<string>();

    for (const item of parsed.rows) {
      const result = transporterValidators.createTransporter.safeParse({ body: item.input });
      if (!result.success) {
        errors.push(
          ...rowErrors(
            IMPORT_COLUMNS,
            item.row,
            result.error.issues.map((issue) => ({ ...issue, path: issue.path.slice(1) })),
            item.slots,
          ),
        );
        continue;
      }
      const input = result.data.body as CreateTransporterInput;
      if (phones.has(input.phone)) {
        errors.push({
          row: item.row,
          field: 'Phone',
          message: 'Duplicate phone — already used by an earlier row in this file',
        });
        continue;
      }
      phones.add(input.phone);
      if (await this.repository.findByPhone(tenantId, input.phone)) {
        errors.push({
          row: item.row,
          field: 'Phone',
          message: `A transporter with phone "${input.phone}" already exists`,
        });
        continue;
      }
      valid.push({ row: item.row, input });
    }
    return { valid, errors };
  }

  async preview(tenantId: string, source: ImportSource): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const { valid, errors } = await this.inspect(parsed, tenantId);
    return startReport(parsed, valid.length, errors);
  }

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    source: ImportSource,
  ): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const { valid, errors } = await this.inspect(parsed, tenantId);
    const report: ImportReport = {
      ...startReport(parsed, valid.length, errors),
      gstVerificationQueued: 0,
    };

    for (const item of valid) {
      let transporter: Awaited<ReturnType<TransporterService['create']>>;
      try {
        // No per-row penny drop: each IDfy bank check can take ~15s. Imported accounts stay
        // unverified until the transporter is next edited.
        transporter = await this.transporters.create(tenantId, actorId, role, item.input, {
          verifyBank: false,
          queueGstVerification: true,
        });
        report.created += 1;
      } catch (error) {
        errors.push({
          row: item.row,
          message: error instanceof Error ? error.message : 'Failed to create transporter',
        });
        continue;
      }
      if (transporter.gstin && transporter.gstVerificationStatus === 'pending') {
        const queued = await this.gstVerification.enqueue({
          tenantId,
          recordId: transporter.id,
          actorId,
        });
        if (queued) report.gstVerificationQueued! += 1;
      }
    }
    finishReport(report);

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'TRANSPORTER_BULK_IMPORTED',
      resourceType: 'transporter',
      newData: {
        fileName: source.fileName,
        totalRows: report.total,
        created: report.created,
        failed: report.failed,
        gstVerificationQueued: report.gstVerificationQueued,
      },
    });
    return report;
  }

  private async parse(source: ImportSource): Promise<ParsedTransporterSheet> {
    try {
      return await parseTransporterSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
