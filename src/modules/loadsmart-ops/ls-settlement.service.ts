import { LoadDocumentService } from '../loads/documents/load-document.service';
import { DocumentReviewDecision } from '../loads/documents/load-document.types';
import { ReviewPodInput, UnloadingDetailsInput } from '../loads/utils/load.interface';
import { hasLoadingPapers } from '../loads/utils/load-stages';
import { NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadService } from '../loads/core/load.service';
import { LoadStageService } from '../loads/core/load-stage.service';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadsmartRepository } from './loadsmart.repository';
import { LsServiceBase } from './ls-base';
import { LoadsmartActor, RateLoadInput } from './loadsmart.interface';

/** The three papers that move a Loadsmart load to Loaded once approved. */
const LOADING_PAPER_TYPES = ['invoice', 'eway_bill', 'signed_lr'];

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
