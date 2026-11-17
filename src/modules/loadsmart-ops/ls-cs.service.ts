import { DataSource } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { CodeSequenceRepository } from '../loads/code-sequence/code-sequence.repository';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadStageService } from '../loads/core/load-stage.service';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { ClaimRecoveryMode, LOADSMART_SEQUENCE_SCOPE } from './loadsmart.types';
import { claimShares } from './billing-rules';
import { LsServiceBase } from './ls-base';
import type { LsReceivablesService } from './ls-receivables.service';
import { LoadsmartActor } from './loadsmart.interface';
import { LS_CS } from '../../shared/constants/permissions';

export interface UpdateClaimInput {
  csAssessment?: number;
  agreedAmount?: number;
  recoveryMode?: ClaimRecoveryMode;
  /** With `split`: the carrier's share; Loadsmart absorbs the rest. */
  carrierAmount?: number;
  shipperDebitNoteRef?: string;
  /** Repair estimates, the shipper's damage letter, carrier statement, more photos. */
  evidenceFileKeys?: string[];
  note?: string;
}

const CREDIT_NOTE_OFFSET = 1000;

/**
 * Customer support's claims (C01) on Loadsmart loads delivered with issues. A claim opens when
 * Tracking marks the load Delivered with issues; Tracking assigns a CS agent; CS assesses it,
 * adds evidence, agrees an amount and says who bears it. Closing it issues Loadsmart's credit
 * note to the shipper, passes the carrier's share to Payables (it comes off the carrier's
 * balance) and moves the load to Delivered without issues — or, if Receivables has already
 * billed, settles the issue where the load is. Tickets (C02) are not in this build.
 */
export class LsCsService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly stageService: LoadStageService,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
    /** A credit note on a billed load comes off what the shipper owes at once. */
    private readonly receivables: Pick<LsReceivablesService, 'refreshForLoad'>,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  /** CS inbox: open claims, oldest first, with age and agent; unassigned ones flagged. */
  async inbox(filter: { mine?: boolean; actorId: string }) {
    const claims = await this.repository.claims.find({
      where: { status: 'open', ...(filter.mine ? { assignedTo: filter.actorId } : {}) },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    const now = this.now().getTime();
    return Promise.all(
      claims.map(async (claim) => {
        const sourcing = await this.repository.findSourcingByLoad(claim.loadId);
        return {
          claim,
          load: sourcing?.load ?? null,
          partner: sourcing?.partner
            ? {
                id: sourcing.partner.id,
                name: sourcing.partner.name,
                phone: sourcing.partner.phone,
              }
            : null,
          ageHours: Math.floor((now - claim.createdAt.getTime()) / 3_600_000),
          unassigned: !claim.assignedTo,
        };
      }),
    );
  }

  async getClaim(loadId: string) {
    const sourcing = await this.assertWonLoad(loadId);
    const claim = await this.repository.findClaim(loadId);
    if (!claim) throw new NotFoundError('This load has no claim');
    const [creditNotes, evidence] = await Promise.all([
      this.repository.creditNotes.findBy({ loadId }),
      this.documents.list(sourcing.tenantId, 'platform_admin', loadId),
    ]);
    return {
      claim,
      creditNotes,
      // Driver photos and video, the POD back, the damage photos, and what CS added.
      evidence: evidence.filter((doc) =>
        ['pod_front', 'pod_back', 'damage_photo', 'stamped_invoice', 'claim_evidence'].includes(
          doc.docType,
        ),
      ),
      load: sourcing.load,
    };
  }

  /** Tracking assigns a CS agent. */
  async assign(actorId: string, loadId: string, agentId: string): Promise<LoadClaimEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const claim = await this.openClaim(loadId);
      if (!(await this.repository.userHasPermission(agentId, LS_CS))) {
        throw new ValidationError('Assign the claim to a Customer support member');
      }
      await this.patchClaim(
        { id: claim.id },
        {
          assignedTo: agentId,
          assignedAt: this.now(),
          history: [...claim.history, this.entry(actorId, 'assigned', { agentId })],
        },
      );
      await this.step(sourcing, actorId, 'claim_assigned', 'LS_CLAIM_UPDATED', { agentId });
      return (await this.repository.claims.findOneBy({ id: claim.id }))!;
    } catch (error) {
      rethrow(error, 'Failed to assign the claim');
    }
  }

  /** CS works the claim: assessment, agreed amount, who bears it, evidence. */
  async update(
    actor: LoadsmartActor,
    loadId: string,
    input: UpdateClaimInput,
  ): Promise<LoadClaimEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const claim = await this.openClaim(loadId);
      for (const key of input.evidenceFileKeys ?? []) {
        await this.storageService.attachStaffUpload(
          actor.id,
          key,
          'loads/claim-evidence',
          sourcing.tenantId,
        );
      }
      if (input.evidenceFileKeys?.length) {
        await this.documents.save(
          sourcing.tenantId,
          sourcing.load,
          { updatedBy: actor.id },
          { userId: actor.id, source: 'console' },
          input.evidenceFileKeys.map((fileKey) => ({
            docType: 'claim_evidence' as const,
            fileKey,
          })),
        );
      }
      const agreed = input.agreedAmount ?? (claim.agreedAmount ? Number(claim.agreedAmount) : null);
      const mode = input.recoveryMode ?? claim.recoveryMode;
      let shares: { carrier: number; loadsmart: number } | null = null;
      if (agreed !== null && mode) {
        const result = claimShares(
          agreed,
          mode,
          input.carrierAmount ??
            (mode === 'split' && claim.partnerRecovery ? Number(claim.partnerRecovery) : undefined),
        );
        if ('error' in result) throw new ValidationError(result.error);
        shares = result;
      }
      await this.patchClaim(
        { id: claim.id },
        {
          ...(input.csAssessment !== undefined ? { csAssessment: String(input.csAssessment) } : {}),
          ...(agreed !== null ? { agreedAmount: String(agreed) } : {}),
          ...(mode ? { recoveryMode: mode } : {}),
          ...(shares
            ? { partnerRecovery: String(shares.carrier), loadsmartShare: String(shares.loadsmart) }
            : {}),
          ...(input.shipperDebitNoteRef !== undefined
            ? { shipperDebitNoteRef: input.shipperDebitNoteRef }
            : {}),
          history: [
            ...claim.history,
            this.entry(actor.id, 'updated', {
              ...input,
              ...(shares ? { shares } : {}),
            } as Record<string, unknown>),
          ],
        },
      );
      return (await this.repository.claims.findOneBy({ id: claim.id }))!;
    } catch (error) {
      rethrow(error, 'Failed to update the claim');
    }
  }

  /** "Closing the claim passes the deduction to Receivables and Payables, and moves the load to
   *  Delivered without issues." */
  async close(actorId: string, loadId: string, note: string) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const claim = await this.openClaim(loadId);
      if (claim.agreedAmount === null || !claim.recoveryMode) {
        throw new ValidationError('Agree the amount and who bears it before closing the claim');
      }
      const agreed = Number(claim.agreedAmount);
      const now = this.now();
      const creditNote =
        agreed > 0
          ? await this.dataSource.transaction(async (manager) => {
              const sequence = await this.codeSequenceRepository.next(
                'ls_credit_note',
                LOADSMART_SEQUENCE_SCOPE,
                manager,
              );
              return manager.save(
                this.repository.creditNotes.create({
                  tenantId: sourcing.tenantId,
                  loadId,
                  claimId: claim.id,
                  creditNoteNumber: `LSCN-${CREDIT_NOTE_OFFSET + sequence}`,
                  amount: claim.agreedAmount!,
                  reason: `Claim on ${sourcing.load.code}: ${claim.issue ?? 'delivery issue'}`,
                  shipperDebitNoteRef: claim.shipperDebitNoteRef,
                  issuedBy: actorId,
                }),
              );
            })
          : null;
      const closed = await this.patchClaim(
        { id: claim.id, status: 'open' },
        {
          status: 'settled',
          resolutionNote: note,
          settledBy: actorId,
          settledAt: now,
          history: [
            ...claim.history,
            this.entry(actorId, 'closed', { note, creditNote: creditNote?.creditNoteNumber }),
          ],
        },
      );
      if (!closed.affected) throw new ConflictError('The claim changed — reload it');

      const fields = {
        deliveryIssueSettledAt: now,
        deliveryIssueSettledBy: actorId,
        deliveryIssueSettlementNote: note,
        updatedBy: actorId,
      };
      let load = sourcing.load;
      if (load.status === 'delivered_with_issues') {
        load = await this.stageService.transition({
          tenantId: sourcing.tenantId,
          loadId,
          trigger: 'issue_resolved',
          actorType: 'ls_team',
          actorId,
          load,
          auditAction: 'LOAD_DELIVERY_ISSUE_SETTLED',
          fields,
        });
      } else {
        // Already billed: the issue settles where the load is; the credit note comes off what
        // the shipper owes.
        load = (await this.loadRepository.update(sourcing.tenantId, loadId, fields)) ?? load;
      }
      if (creditNote) await this.receivables.refreshForLoad(actorId, sourcing.tenantId, loadId);
      await this.step(sourcing, actorId, 'claim_closed', 'LS_CLAIM_UPDATED', {
        agreedAmount: agreed,
        carrierShare: claim.partnerRecovery,
        loadsmartShare: claim.loadsmartShare,
        creditNote: creditNote?.creditNoteNumber ?? null,
      });
      return { claim: await this.repository.claims.findOneBy({ id: claim.id }), creditNote, load };
    } catch (error) {
      rethrow(error, 'Failed to close the claim');
    }
  }

  /** jsonb history defeats TypeORM's deep-partial typing; the shape is the entity's own. */
  private patchClaim(where: Partial<LoadClaimEntity>, data: Partial<LoadClaimEntity>) {
    return this.repository.claims.update(
      where as never,
      data as QueryDeepPartialEntity<LoadClaimEntity>,
    );
  }

  private async openClaim(loadId: string): Promise<LoadClaimEntity> {
    const claim = await this.repository.findClaim(loadId);
    if (!claim || claim.status !== 'open') throw new ConflictError('This load has no open claim');
    return claim;
  }

  private entry(by: string, step: string, detail?: Record<string, unknown>) {
    return { at: this.now().toISOString(), by, step, ...(detail ? { detail } : {}) };
  }
}
