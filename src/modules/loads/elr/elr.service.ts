import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoadDocumentService } from '../documents/load-document.service';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository, UpdateLoadData } from '../core/load.repository';
import { LoadEntity } from '../entities/load.entity';
import { istDateOf } from '../verification/verification-rules';
import { buildElrContent } from './elr-content';
import { renderElrPdf } from './elr-pdf';
import { ElrEditInput, ElrInput, GeneratedElr } from '../utils/elr.interface';
import { ElrAction, LoadElrRevisionEntity } from './load-elr-revision.entity';

/** The one e-LR series across Loadsmart (loads.elr_series). */
const ELR_SERIES = 'loadsmart';

/** "LSLR-000123". */
export const formatElrNumber = (prefix: string, value: number) =>
  `${prefix}-${String(value).padStart(6, '0')}`;

/** The next number in the series — the row is locked for the transaction, so two issues never
 *  share a number, and a cancelled number is never handed out again. */
async function nextElrNumber(manager: EntityManager): Promise<string> {
  // TypeORM's Postgres driver answers an UPDATE … RETURNING with [rows, rowCount].
  const result = (await manager.query(
    `UPDATE "loads"."elr_series" SET "next_number" = "next_number" + 1
      WHERE "series" = $1 RETURNING "prefix", "next_number" - 1 AS "number"`,
    [ELR_SERIES],
  )) as unknown[];
  const rows = (Array.isArray(result[0]) ? result[0] : result) as {
    prefix: string;
    number: number;
  }[];
  const row = rows[0];
  if (!row) throw new Error('The e-LR series is not set up');
  return formatElrNumber(row.prefix, Number(row.number));
}

/**
 * The e-LR — Loadsmart loads only, made by Loadsmart's Tracking team from the shipper invoice.
 * One series across Loadsmart; the number and vehicle never change. Tracking can edit it with a
 * reason (carrier replaced the driver, wrong details, relief driver, transhipment), which makes a
 * new PDF under the same number, or cancel it. Every step is a revision (load_elr_revisions), and
 * every PDF goes into the documents register. The *signed* LR the driver brings back is still what
 * completes the loading papers.
 */
export class ElrService {
  private readonly revisions: Repository<LoadElrRevisionEntity>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    /** The generated PDF is recorded in the documents register with the load's columns. */
    private readonly documents: LoadDocumentService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.revisions = dataSource.getRepository(LoadElrRevisionEntity);
  }

  /** Issue the e-LR. "e-LR needs the invoice": uploaded, or its number, date and value typed. */
  async issue(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ElrInput,
  ): Promise<GeneratedElr> {
    try {
      const load = await this.assertLoadsmartLoad(tenantId, loadId);
      if (load.elrNumber) {
        throw new ConflictError(`The e-LR ${load.elrNumber} is already issued — edit it instead`);
      }
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

      const elrNumber = await this.dataSource.transaction(nextElrNumber);
      const fields: UpdateLoadData = {
        elrNumber,
        elrGeneratedAt: this.now(),
        elrPackages: input.packages,
        ...(input.grossWeightTonnes !== undefined && input.tareWeightTonnes !== undefined
          ? { elrNetWeightTonnes: (input.grossWeightTonnes - input.tareWeightTonnes).toFixed(3) }
          : {}),
        elrSealNumber: input.sealNumber ?? null,
        elrShowFreight: Boolean(input.showFreight),
        invoiceNumber,
        ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
        ...(input.invoiceValue !== undefined ? { invoiceValue: String(input.invoiceValue) } : {}),
      };
      return await this.render(tenantId, actorId, actorRole, load, fields, input, {
        action: 'issued',
        reason: null,
        note: null,
      });
    } catch (error) {
      rethrow(error, 'Failed to issue the e-LR');
    }
  }

  /** Edit the e-LR with a reason — a new PDF under the same number. The vehicle never changes; a
   *  relief or replacement driver is put on the load with it. */
  async edit(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ElrEditInput,
  ): Promise<GeneratedElr> {
    try {
      const load = await this.assertLoadsmartLoad(tenantId, loadId);
      if (!load.elrNumber) throw new ConflictError('No e-LR is issued on this load');
      const fields: UpdateLoadData = {
        ...(input.packages !== undefined ? { elrPackages: input.packages } : {}),
        ...(input.sealNumber !== undefined ? { elrSealNumber: input.sealNumber } : {}),
        ...(input.showFreight !== undefined ? { elrShowFreight: input.showFreight } : {}),
        ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
        ...(input.driverMobile !== undefined ? { driverNumber: input.driverMobile } : {}),
      };
      if (!Object.keys(fields).length) throw new ValidationError('Nothing to change on the e-LR');
      const merged = { ...load, ...fields } as LoadEntity;
      return await this.render(
        tenantId,
        actorId,
        actorRole,
        merged,
        fields,
        {
          packages: merged.elrPackages ?? 0,
          sealNumber: merged.elrSealNumber ?? undefined,
          showFreight: merged.elrShowFreight,
        },
        { action: 'edited', reason: input.reason, note: input.note?.trim() || null },
      );
    } catch (error) {
      rethrow(error, 'Failed to edit the e-LR');
    }
  }

  /** Cancel the e-LR. Its number is never reused; a new e-LR takes the next one. */
  async cancel(tenantId: string, actorId: string, loadId: string, note: string) {
    try {
      const load = await this.assertLoadsmartLoad(tenantId, loadId);
      if (!load.elrNumber) throw new ConflictError('No e-LR is issued on this load');
      const elrNumber = load.elrNumber;
      const updated = await this.documents.save(
        tenantId,
        load,
        { elrNumber: null, elrDocumentFileKey: null, elrGeneratedAt: null, updatedBy: actorId },
        { userId: actorId, source: 'console' },
      );
      await this.saveRevision(tenantId, load.id, elrNumber, actorId, {
        action: 'cancelled',
        reason: null,
        note,
        changes: null,
        fileKey: null,
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_UPLOADED',
        elrNumber,
        null,
        {
          elrCancelled: true,
          elrNumber,
          note,
        },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_ELR_CANCELLED',
        resourceType: 'load',
        newData: { id: loadId, elrNumber, note },
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to cancel the e-LR');
    }
  }

  /** The e-LR's change history, oldest first. */
  async listRevisions(tenantId: string, loadId: string): Promise<LoadElrRevisionEntity[]> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      return await this.revisions.find({ where: { tenantId, loadId }, order: { revision: 'ASC' } });
    } catch (error) {
      rethrow(error, 'Failed to read the e-LR history');
    }
  }

  private async assertLoadsmartLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findDetailById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    // "No e-LR on own transporter, indent or own fleet": the shipper's own LR is used there.
    if (load.route !== 'loadsmart') {
      throw new ConflictError('The e-LR is made only on Loadsmart loads');
    }
    return load;
  }

  private async render(
    tenantId: string,
    actorId: string,
    actorRole: string,
    load: LoadEntity,
    fields: UpdateLoadData,
    input: ElrInput,
    revision: { action: ElrAction; reason: string | null; note: string | null },
  ): Promise<GeneratedElr> {
    const elrNumber = (fields.elrNumber ?? load.elrNumber)!;
    const view = { ...load, ...fields } as LoadEntity;
    const content = buildElrContent(view, elrNumber, istDateOf(this.now()), {
      ...input,
      invoiceNumber: view.invoiceNumber ?? undefined,
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
    const updated = await this.documents.save(
      tenantId,
      load,
      { ...fields, elrDocumentFileKey: file.key, updatedBy: actorId },
      { userId: actorId, source: 'console' },
    );
    await this.saveRevision(tenantId, load.id, elrNumber, actorId, {
      ...revision,
      changes: { ...fields } as Record<string, unknown>,
      fileKey: file.key,
    });
    await this.loadActivityService.record(
      tenantId,
      load.id,
      actorId,
      'DOCUMENT_UPLOADED',
      null,
      null,
      {
        elrNumber,
        elrAction: revision.action,
        reason: revision.reason,
      },
    );
    await this.auditService.log({
      tenantId,
      userId: actorId,
      action: revision.action === 'issued' ? 'LOAD_ELR_GENERATED' : 'LOAD_ELR_EDITED',
      resourceType: 'load',
      newData: { id: load.id, elrNumber, fileKey: file.key, reason: revision.reason },
    });
    const { downloadUrl } = await this.storageService.getByKey(
      { tenantId, role: actorRole },
      file.key,
    );
    return { load: updated, elrNumber, downloadUrl };
  }

  private async saveRevision(
    tenantId: string,
    loadId: string,
    elrNumber: string,
    actorId: string,
    data: Pick<LoadElrRevisionEntity, 'action' | 'reason' | 'note' | 'changes' | 'fileKey'>,
  ): Promise<void> {
    const last = await this.revisions.findOne({
      where: { tenantId, loadId },
      order: { revision: 'DESC' },
    });
    await this.revisions.save(
      this.revisions.create({
        tenantId,
        loadId,
        elrNumber,
        revision: (last?.revision ?? 0) + 1,
        createdBy: actorId,
        ...data,
      }),
    );
  }
}
