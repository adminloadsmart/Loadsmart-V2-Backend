import { LoadDocumentService } from '../loads/documents/load-document.service';
import {
  DocumentReviewDecision,
  SHIPPER_PRECEDENCE_TYPES,
} from '../loads/documents/load-document.types';
import { ReviewPodInput, UnloadingDetailsInput } from '../loads/utils/load.interface';
import { hasLoadingPapers } from '../loads/utils/load-stages';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadService } from '../loads/core/load.service';
import { LoadStageService } from '../loads/core/load-stage.service';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadsmartRepository } from './loadsmart.repository';
import { LsServiceBase } from './ls-base';
import {
  ConsolePodInput,
  DocumentsPageQuery,
  LoadsmartActor,
  PapersInput,
  RateLoadInput,
} from './loadsmart.interface';

/** The three papers that move a Loadsmart load to Loaded once approved. */
const LOADING_PAPER_TYPES: string[] = ['invoice', 'eway_bill', 'signed_lr'];

/**
 * Loadsmart load, delivery side: Tracking decides the POD (clean → Delivered, an issue →
 * Delivered with issues and a CS claim opens) and approves the loading papers through the
 * documents register; the unloading details; ratings; the console's load page. Claims are CS's
 * (ls-cs.service), billing is Receivables' (ls-receivables.service) and the original POD and the
 * carrier balance are Payables' (ls-payables.service).
 */
export class LsSettlementService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly loadRepository: LoadRepository,
    private readonly loadService: LoadService,
    private readonly stageService: LoadStageService,
    private readonly documents: LoadDocumentService,
    private readonly storageService: StorageService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  /** Stage hook: a Loadsmart load delivered with issues opens its CS claim. */
  onStageEntered = async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (load.route !== 'loadsmart' || to !== 'delivered_with_issues') return;
    const existing = await this.repository.findClaim(load.id);
    if (existing) {
      await this.repository.claims.update(
        { id: existing.id },
        { status: 'open', issue: load.shortageOrDamage },
      );
      return;
    }
    await this.repository.claims.save(
      this.repository.claims.create({
        tenantId: load.tenantId,
        loadId: load.id,
        status: 'open',
        issue: load.shortageOrDamage,
      }),
    );
  };

  /** "Rates the shipper and the partner." */
  async rate(actorId: string, loadId: string, input: RateLoadInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      for (const [subject, score] of [
        ['shipper', input.shipperScore],
        ['partner', input.partnerScore],
      ] as const) {
        await this.repository.ratings.upsert(
          {
            tenantId: sourcing.tenantId,
            loadId,
            subject,
            partnerId: subject === 'partner' ? sourcing.partnerId : null,
            score,
            note: input.note ?? null,
            ratedBy: actorId,
          },
          ['loadId', 'subject'],
        );
      }
      await this.step(sourcing, actorId, 'rated', 'LS_LOAD_RATED', {
        shipperScore: input.shipperScore,
        partnerScore: input.partnerScore,
      });
      return this.repository.ratings.findBy({ loadId });
    } catch (error) {
      rethrow(error, 'Failed to rate the load');
    }
  }

  /** Tracking decides the POD on a Loadsmart load: clean → Delivered, an issue → Delivered with
   *  issues (CS opens the claim), or rejected back to the driver. */
  async decidePod(actorId: string, loadId: string, input: ReviewPodInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      return await this.loadService.reviewPod(sourcing.tenantId, actorId, loadId, input, 'ls_team');
    } catch (error) {
      rethrow(error, 'Failed to decide the POD');
    }
  }

  /** Tracking adds the unloading details on a Loadsmart load. */
  async setUnloadingDetails(actorId: string, loadId: string, input: UnloadingDetailsInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.loadService.setUnloadingDetails(
      sourcing.tenantId,
      actorId,
      loadId,
      input,
      'ls_team',
    );
  }

  /** A Loadsmart load's documents register, for the console. */
  async listDocuments(actor: LoadsmartActor, loadId: string, includeHistory: boolean) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.documents.list(sourcing.tenantId, actor.role, loadId, includeHistory);
  }

  /** Tracking approves or rejects a document on a Loadsmart load. "Truck waits for approval":
   *  once the invoice, e-way bill and signed LR are all approved, the load moves to Loaded. */
  async reviewDocument(
    actor: LoadsmartActor,
    loadId: string,
    documentId: string,
    input: { decision: DocumentReviewDecision; reason?: string },
  ) {
    const sourcing = await this.assertWonLoad(loadId);
    const reviewed = await this.documents.review(
      sourcing.tenantId,
      actor.id,
      actor.role,
      loadId,
      documentId,
      input.decision,
      input.reason,
      'ls_team',
    );
    if (input.decision === 'approved') {
      await this.moveIfPapersApproved(sourcing.tenantId, actor, loadId);
    }
    return reviewed;
  }

  /**
   * Tracking attaches the loading papers it holds when the shipper hasn't uploaded them. The
   * shipper's (or the driver's) copy always takes precedence: Tracking reviews that one instead of
   * replacing it. Tracking's own copies are approved as they are attached, and show to the shipper
   * for reference only until the shipper uploads its own. Invoice, e-way bill (with its validity
   * date) and signed LR.
   */
  async uploadPapers(actor: LoadsmartActor, loadId: string, input: PapersInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const tenantId = sourcing.tenantId;
      const allowed: LoadStatus[] = [
        'truck_assigned',
        'in_transit_loading',
        'reached_loading',
        'loaded',
        'in_transit_unloading',
        'reached_unloading',
      ];
      if (!allowed.includes(sourcing.load.status)) {
        throw new ConflictError(
          'Papers are attached from truck assignment until the truck unloads',
        );
      }
      const current = await this.documents.list(tenantId, actor.role, loadId);
      const papers = [
        ['invoice', input.invoiceFileKey, 'loads/invoice', 'goods invoice'],
        ['eway_bill', input.ewayBillFileKey, 'loads/eway-bill', 'e-way bill'],
        ['signed_lr', input.elrFileKey, 'trips/lr', 'signed LR'],
      ] as const;
      for (const [docType, fileKey, purpose, label] of papers) {
        if (!fileKey) continue;
        const theirs = current.find((doc) => doc.docType === docType && doc.current);
        if (theirs && theirs.source !== 'console' && theirs.reviewStatus !== 'rejected') {
          throw new ConflictError(
            `The ${label} was already uploaded by the ${theirs.source === 'driver_app' ? 'driver' : 'shipper'} — review that copy instead`,
          );
        }
        await this.storageService.attachStaffUpload(actor.id, fileKey, purpose, tenantId);
      }
      await this.loadService.saveConsoleDocuments(tenantId, actor.id, actor.role, loadId, input);
      // Tracking's own copies need no one else to approve them.
      const fresh = await this.documents.list(tenantId, actor.role, loadId);
      for (const doc of fresh) {
        if (
          doc.current &&
          doc.source === 'console' &&
          doc.reviewStatus === 'pending' &&
          LOADING_PAPER_TYPES.includes(doc.docType)
        ) {
          await this.documents.review(
            tenantId,
            actor.id,
            actor.role,
            loadId,
            doc.id,
            'approved',
            undefined,
            'ls_team',
          );
        }
      }
      await this.moveIfPapersApproved(tenantId, actor, loadId);
      await this.step(sourcing, actor.id, 'papers_uploaded_by_tracking', 'LS_PAPERS_UPLOADED', {
        invoice: Boolean(input.invoiceFileKey),
        ewayBill: Boolean(input.ewayBillFileKey),
        signedLr: Boolean(input.elrFileKey),
      });
      return this.documents.list(tenantId, actor.role, loadId);
    } catch (error) {
      rethrow(error, 'Failed to attach the papers');
    }
  }

  /**
   * Tracking records the POD Loadsmart's own team captured, with the delivery outcome: delivered
   * without issues, or with issues (damage, shortage or pilferage, and a remark). There is no
   * approval step for these — only a POD that came through the driver app waits for a decision
   * (decidePod). Receiver name and quantity default to "recorded by Loadsmart" and the planned
   * tonnes when Tracking doesn't have them.
   */
  async uploadPod(actor: LoadsmartActor, loadId: string, input: ConsolePodInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const tenantId = sourcing.tenantId;
      const withIssues = input.outcome === 'delivered_with_issues';
      if (withIssues && (!input.issueType || !input.remark)) {
        throw new ValidationError('Give the issue type and a remark when delivered with issues');
      }
      for (const fileKey of [input.podFileKey, input.podBackFileKey]) {
        if (fileKey)
          await this.storageService.attachStaffUpload(actor.id, fileKey, 'trips/pod', tenantId);
      }
      const issue = withIssues ? input.issueType! : 'none';
      await this.loadService.uploadPod(
        tenantId,
        actor.id,
        actor.role,
        loadId,
        {
          podFileKey: input.podFileKey,
          podBackFileKey: input.podBackFileKey,
          podReceiverName: input.receiverName ?? 'Recorded by Loadsmart',
          podQuantityReceived:
            input.quantityReceived ?? Number(sourcing.load.plannedCapacityTonnes),
          shortageOrDamage: issue,
          numberOfTonnesShort: input.numberOfTonnesShort,
          podRemarks: input.remark,
        },
        undefined,
        true,
      );
      return await this.loadService.reviewPod(
        tenantId,
        actor.id,
        loadId,
        { decision: 'accepted', shortageOrDamage: issue, issueDetails: input.remark },
        'ls_team',
      );
    } catch (error) {
      rethrow(error, 'Failed to record the POD');
    }
  }

  /** The documents page: every document of every Loadsmart load, searchable by load code, LR /
   *  e-LR number or e-LR series, with a link to view or download each. */
  async documentsPage(actor: LoadsmartActor, query: DocumentsPageQuery) {
    const limit = Math.min(query.limit ?? 50, 200);
    const page = Math.max(query.page ?? 1, 1);
    const [rows, total] = await this.repository.searchDocuments({ ...query, page, limit });
    const items = await Promise.all(
      rows.map(async (doc) => ({
        id: doc.id,
        docType: doc.docType,
        version: doc.version,
        current: doc.supersededAt === null,
        source: doc.source,
        reviewStatus: doc.reviewStatus,
        uploadedAt: doc.createdAt,
        referenceOnly: doc.source === 'console' && SHIPPER_PRECEDENCE_TYPES.includes(doc.docType),
        load: {
          id: doc.loadId,
          code: doc.load?.code ?? null,
          tenantId: doc.tenantId,
          elrNumber: doc.load?.elrNumber ?? null,
          invoiceNumber: doc.load?.invoiceNumber ?? null,
          ewayBillNumber: doc.load?.ewayBillNumber ?? null,
        },
        downloadUrl: await this.storageService
          .getByKey({ tenantId: doc.tenantId, role: actor.role }, doc.fileKey)
          .then((file) => file.downloadUrl)
          .catch(() => null),
      })),
    );
    return { total, page, limit, items };
  }

  private async moveIfPapersApproved(tenantId: string, actor: LoadsmartActor, loadId: string) {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load || load.status !== 'reached_loading' || !hasLoadingPapers(load)) return;
    const docs = await this.documents.list(tenantId, actor.role, loadId);
    const approved = (docType: string) =>
      docs.some((doc) => doc.docType === docType && doc.current && doc.reviewStatus === 'approved');
    if (!LOADING_PAPER_TYPES.every(approved)) return;
    const now = this.now();
    await this.stageService.transition({
      tenantId,
      loadId,
      trigger: 'papers_complete',
      actorType: 'ls_team',
      actorId: actor.id,
      load,
      auditAction: 'LS_PAPERS_APPROVED',
      fields: { lsPapersApprovedAt: now, loadingConfirmedBy: actor.id },
    });
  }

  /** Everything Loadsmart holds on one load — the console's load page. */
  async loadDetail(loadId: string) {
    const sourcing = await this.repository.findSourcingByLoad(loadId);
    if (!sourcing) throw new NotFoundError(`Loadsmart load ${loadId} not found`);
    const [
      partnerBids,
      partnerPayments,
      charges,
      claim,
      invoice,
      ratings,
      creditNotes,
      originalPod,
    ] = await Promise.all([
      this.repository.listPartnerBids(sourcing.id),
      this.repository.partnerPayments.findBy({ sourcingId: sourcing.id }),
      this.repository.listCharges(sourcing.tenantId, sourcing.loadId),
      this.repository.findClaim(sourcing.loadId),
      this.repository.findInvoice(sourcing.tenantId, sourcing.loadId),
      this.repository.ratings.findBy({ loadId: sourcing.loadId }),
      this.repository.creditNotes.findBy({ loadId: sourcing.loadId }),
      this.repository.originalPods.findOneBy({ loadId: sourcing.loadId }),
    ]);
    return {
      sourcing,
      partnerBids,
      partnerPayments,
      charges,
      claim,
      invoice,
      ratings,
      creditNotes,
      originalPod,
    };
  }
}
