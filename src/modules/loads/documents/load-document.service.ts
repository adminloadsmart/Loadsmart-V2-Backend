import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository, UpdateLoadData } from '../core/load.repository';
import { LoadEntity } from '../entities/load.entity';
import { isLoadsmartLoad } from '../utils/load-stages';
import { initialReviewStatus, planDocumentChanges, reviewBlocker } from './document-rules';
import { LoadDocumentEntity } from './load-document.entity';
import { LoadDocumentRepository } from './load-document.repository';
import {
  DOCUMENT_COLUMNS,
  DocumentActor,
  DocumentReviewDecision,
  ExtraDocument,
  LoadDocumentView,
  POD_DOCUMENT_TYPES,
  SHIPPER_PRECEDENCE_TYPES,
} from './load-document.types';

/**
 * The load's documents register. Every upload goes through `save`: the load's columns (including
 * the pointer to each type's current file) and the register rows are written in one transaction,
 * so the register always agrees with the load and nothing uploaded is ever lost to a re-upload.
 */
export class LoadDocumentService {
  constructor(
    private readonly repository: LoadDocumentRepository,
    private readonly loadRepository: LoadRepository,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Writes `fields` to the load and records every document they (and `extras`) change. Returns
   *  the updated load. The load row is updated first, which locks it — two uploads to one load
   *  take their versions one after the other — so `fields` always carries at least updatedBy. */
  async save(
    tenantId: string,
    load: LoadEntity,
    fields: UpdateLoadData,
    actor: DocumentActor,
    extras: ExtraDocument[] = [],
  ): Promise<LoadEntity> {
    return this.repository.transaction(async (manager) => {
      const updated = await this.loadRepository.update(tenantId, load.id, fields, manager);
      if (!updated) throw new ConflictError('Saving the load documents failed');

      const current = await this.repository.listCurrent(manager, tenantId, load.id);
      const plan = planDocumentChanges(
        current,
        await this.repository.maxVersions(manager, load.id),
        fields,
        extras,
      );
      const at = this.now();
      await this.repository.supersede(manager, plan.supersede, at);
      const loadsmart = isLoadsmartLoad(updated);
      await this.repository.insert(
        manager,
        plan.add.map((doc) => {
          const numberColumn = DOCUMENT_COLUMNS[doc.docType]?.numberColumn;
          const number = numberColumn ? (updated[numberColumn as keyof LoadEntity] ?? null) : null;
          return {
            tenantId,
            loadId: load.id,
            docType: doc.docType,
            fileKey: doc.fileKey,
            version: doc.version,
            supersedesId: doc.supersedesId,
            source: actor.source,
            uploadedBy: actor.userId,
            uploadedByDriverId: actor.driverId ?? null,
            reviewStatus: initialReviewStatus(doc.docType, loadsmart),
            extracted: number ? { number } : null,
          };
        }),
      );
      return updated;
    });
  }

  /** File keys of the load's current documents of the given types (no download URLs). */
  async currentFileKeys(
    tenantId: string,
    loadId: string,
    docTypes: string[],
  ): Promise<Record<string, string>> {
    const docs = await this.repository.list(tenantId, loadId, false);
    const keys: Record<string, string> = {};
    for (const doc of docs) if (docTypes.includes(doc.docType)) keys[doc.docType] = doc.fileKey;
    return keys;
  }

  /** The load's current documents (or every version, with `includeHistory`), with download URLs. */
  async list(
    tenantId: string,
    actorRole: string,
    loadId: string,
    includeHistory = false,
  ): Promise<LoadDocumentView[]> {
    try {
      await this.assertLoad(tenantId, loadId);
      const docs = await this.repository.list(tenantId, loadId, includeHistory);
      return Promise.all(docs.map((doc) => this.toView(doc, tenantId, actorRole)));
    } catch (error) {
      rethrow(error, 'Failed to list the load documents');
    }
  }

  /** Approve or reject one current document. The shipper reviews documents on their own loads;
   *  on a Loadsmart load Loadsmart's Tracking team does (from the ops console). A rejected
   *  document waits for a re-upload, which comes in as the next version. */
  async review(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    documentId: string,
    decision: DocumentReviewDecision,
    reason: string | undefined,
    reviewer: 'shipper' | 'ls_team',
  ): Promise<LoadDocumentView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const doc = await this.repository.findById(tenantId, loadId, documentId);
      if (!doc) throw new NotFoundError(`Document ${documentId} not found on load ${loadId}`);
      const blocker = reviewBlocker(doc, isLoadsmartLoad(load), reviewer);
      if (blocker) throw new ConflictError(blocker);
      if (decision === 'rejected' && !reason?.trim()) {
        throw new ValidationError('reason is required when rejecting a document');
      }

      const fields = {
        reviewStatus: decision,
        rejectionReason: decision === 'rejected' ? reason!.trim() : null,
        reviewedBy: actorId,
        reviewedAt: this.now(),
      };
      if (!(await this.repository.decide(doc, fields))) {
        throw new ConflictError('A newer version of this document arrived — review that one');
      }
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_REVIEWED',
        doc.reviewStatus,
        decision,
        { documentId, docType: doc.docType, version: doc.version, reason: fields.rejectionReason },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: decision === 'approved' ? 'LOAD_DOCUMENT_APPROVED' : 'LOAD_DOCUMENT_REJECTED',
        resourceType: 'load_document',
        oldData: { id: documentId, reviewStatus: doc.reviewStatus },
        newData: { id: documentId, loadId, docType: doc.docType, ...fields },
      });
      return this.toView({ ...doc, ...fields }, tenantId, actorRole);
    } catch (error) {
      rethrow(error, 'Failed to review the document');
    }
  }

  /** The POD decision, applied to the POD's current files. */
  async decidePod(
    tenantId: string,
    loadId: string,
    actorId: string,
    decision: DocumentReviewDecision,
    reason: string | null,
  ): Promise<void> {
    await this.repository.decideCurrent(tenantId, loadId, POD_DOCUMENT_TYPES, {
      reviewStatus: decision,
      rejectionReason: decision === 'rejected' ? reason : null,
      reviewedBy: actorId,
      reviewedAt: this.now(),
    });
  }

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  private async toView(
    doc: LoadDocumentEntity,
    tenantId: string,
    actorRole: string,
  ): Promise<LoadDocumentView> {
    let downloadUrl: string | null = null;
    try {
      ({ downloadUrl } = await this.storageService.getByKey(
        { tenantId, role: actorRole },
        doc.fileKey,
      ));
    } catch {
      // A file the caller can't read (or one gone from storage) is listed without a link.
    }
    return {
      id: doc.id,
      docType: doc.docType,
      version: doc.version,
      fileKey: doc.fileKey,
      downloadUrl,
      current: doc.supersededAt === null,
      supersedesId: doc.supersedesId,
      supersededAt: doc.supersededAt?.toISOString() ?? null,
      source: doc.source,
      uploadedBy: doc.uploadedBy,
      uploadedByDriverId: doc.uploadedByDriverId,
      uploadedAt: doc.createdAt.toISOString(),
      reviewStatus: doc.reviewStatus,
      rejectionReason: doc.rejectionReason,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt?.toISOString() ?? null,
      extracted: doc.extracted,
      referenceOnly: doc.source === 'console' && SHIPPER_PRECEDENCE_TYPES.includes(doc.docType),
    };
  }
}
