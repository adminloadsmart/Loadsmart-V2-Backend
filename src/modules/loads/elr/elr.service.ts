import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { CodeSequenceRepository } from '../code-sequence.repository';
import { LoadActivityService } from '../load-activity.service';
import { LoadRepository } from '../load.repository';
import { LoadEntity } from '../entities/load.entity';
import { formatLrNumber } from '../utils/code.util';
import { istDateOf } from '../verification/verification-rules';
import { buildElrContent, ElrInput } from './elr-content';
import { renderElrPdf } from './elr-pdf';

export interface GeneratedElr {
  load: LoadEntity;
  elrNumber: string;
  /** Short-lived download URL of the generated PDF. */
  downloadUrl: string | null;
}

/**
 * Makes the e-LR at the loading point. "e-LR needs the invoice": the invoice must be on the load
 * (number and uploaded file), or — as own fleet may — typed in with its number, date and value.
 * The shipper adds packages and seal; the rest fills in from the load, and freight stays hidden
 * unless they tick it. The PDF is stored like any uploaded LR (purpose trips/lr), on its own
 * field: the *signed* LR the driver brings back is still what completes the loading papers.
 */
export class ElrService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ElrInput,
  ): Promise<GeneratedElr> {
    try {
      const load = await this.loadRepository.findDetailById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      if (load.status !== 'reached_loading' && load.status !== 'loaded') {
        throw new ConflictError('The e-LR is made at the loading point');
      }

      const invoiceNumber = input.invoiceNumber?.trim() || load.invoiceNumber;
      const typedInvoice = Boolean(input.invoiceDate && input.invoiceValue !== undefined);
      if (!invoiceNumber || (!load.invoiceFileKey && !typedInvoice)) {
        throw new ValidationError(
          'The e-LR needs the invoice — upload it, or type its number, date and value',
        );
      }

      const elrNumber =
        load.elrNumber ??
        formatLrNumber(
          await this.dataSource.transaction((manager) =>
            this.codeSequenceRepository.next('lr', tenantId, manager),
          ),
        );
      const clash = await this.loadRepository.findByElrNumber(tenantId, elrNumber);
      if (clash && clash.id !== loadId) {
        throw new ConflictError(`E-LR number "${elrNumber}" is already used on load ${clash.code}`);
      }

      const now = this.now();
      const content = buildElrContent(load, elrNumber, istDateOf(now), {
        ...input,
        invoiceNumber,
      });
      const pdf = await renderElrPdf(content);
      const file = await this.storageService.uploadTenantFile(
        tenantId,
        actorId,
        {
          purpose: 'trips/lr',
          fileName: `${elrNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
        },
        pdf,
      );

      const updated = await this.loadRepository.update(tenantId, loadId, {
        elrNumber,
        elrDocumentFileKey: file.key,
        elrGeneratedAt: now,
        elrPackages: input.packages,
        elrSealNumber: input.sealNumber ?? null,
        elrShowFreight: Boolean(input.showFreight),
        invoiceNumber,
        ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
        ...(input.invoiceValue !== undefined ? { invoiceValue: String(input.invoiceValue) } : {}),
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Saving the e-LR failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_UPLOADED',
        null,
        null,
        { elrGenerated: true, elrNumber, showFreight: Boolean(input.showFreight) },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_ELR_GENERATED',
        resourceType: 'load',
        newData: { id: loadId, elrNumber, fileKey: file.key },
      });

      const { downloadUrl } = await this.storageService.getByKey(
        { tenantId, role: actorRole },
        file.key,
      );
      return { load: updated, elrNumber, downloadUrl };
    } catch (error) {
      rethrow(error, 'Failed to generate the e-LR');
    }
  }
}
