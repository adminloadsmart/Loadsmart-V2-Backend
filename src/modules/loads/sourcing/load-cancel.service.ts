import { DataSource, Repository } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { SettingsReader } from '../../settings/settings.types';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadBidRepository } from '../bids/load-bid.repository';
import { LoadRepository } from '../core/load.repository';
import { LoadStageService } from '../core/load-stage.service';
import { LoadCancellationEntity } from '../entities/load-cancellation.entity';
import { LoadEntity } from '../entities/load.entity';
import { LoadMemoRepository } from '../memo/load-memo.repository';
import { LOAD_CANCELLABLE_STAGES } from '../money/money-rules';
import { isLoadsmartLoad } from '../utils/load-stages';

export interface CancelLoadInput {
  /** An active reason code from Super Admin → Settings (e.g. shipper_cancelled). */
  reasonCode: string;
  note?: string;
}

export interface CancelLoadResult {
  /** `cancelled`: done; `pending`: a Loadsmart load waiting for Super Admin. */
  outcome: 'cancelled' | 'pending';
  load: LoadEntity;
  cancellation: LoadCancellationEntity;
}

/**
 * Cancelling a whole load, any time before Loaded ("cancellations do happen even after
 * confirmation"), with a reason code from Settings:
 *  - own transporter, indent, own fleet, and market loads nobody has won yet: cancelled at once;
 *  - a load Loadsmart has won (its bid accepted, or its memo accepted): a request Super Admin
 *    approves or rejects on the ops console — the broker may already have a truck on the way.
 * Cancelling rejects every open bid and withdraws an open memo; the Loadsmart module's stage hook
 * closes its own side (the sourcing). The load moves to Cancelled, outside the 13 stages, and the
 * cancellation with its reason stays in load_cancellations.
 */
export class LoadCancelService {
  private readonly cancellations: Repository<LoadCancellationEntity>;

  constructor(
    dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly stageService: LoadStageService,
    private readonly bidRepository: LoadBidRepository,
    private readonly memoRepository: LoadMemoRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly settings: SettingsReader,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cancellations = dataSource.getRepository(LoadCancellationEntity);
  }

  /** The shipper cancels (or asks to, on a Loadsmart load). */
  async cancel(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: CancelLoadInput,
  ): Promise<CancelLoadResult> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      this.assertCancellable(load);
      const reason = await this.assertReason(load, input.reasonCode);
      const pending = await this.cancellations.findOneBy({
        tenantId,
        loadId,
        kind: 'load',
        status: 'pending',
      });
      if (pending) throw new ConflictError('A cancellation is already waiting for Super Admin');

      const row = this.cancellations.create({
        tenantId,
        loadId,
        kind: 'load',
        reasonCode: reason.code,
        note: input.note?.trim() || null,
        nextStep: null,
        fromStage: load.status,
        transporterId: load.transporterId,
        vehicleNumber: load.vehicleNumber,
        driverName: load.driverName,
        driverMobile: load.driverNumber,
        cancelledBy: actorId,
      });

      if (isLoadsmartLoad(load)) {
        const cancellation = await this.cancellations.save({ ...row, status: 'pending' });
        await this.loadActivityService.record(
          tenantId,
          loadId,
          actorId,
          'LOAD_CANCEL_REQUESTED',
          load.status,
          null,
          { cancellationId: cancellation.id, reasonCode: reason.code, reason: reason.label },
        );
        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'LOAD_CANCEL_REQUESTED',
          resourceType: 'load',
          newData: { id: loadId, cancellationId: cancellation.id, reasonCode: reason.code },
        });
        return { outcome: 'pending', load, cancellation };
      }

      const updated = await this.cancelNow(load, actorId, 'shipper', reason.code);
      const cancellation = await this.cancellations.save({ ...row, status: 'approved' });
      return { outcome: 'cancelled', load: updated, cancellation };
    } catch (error) {
      rethrow(error, 'Failed to cancel the load');
    }
  }

  /** What the cancel form needs: whether this load can be cancelled now (and why not), whether
   *  it waits for Super Admin, a request already waiting, the latest decision, and the active
   *  reason codes from the settings the load was posted under (also used to cancel a truck). */
  async options(tenantId: string, loadId: string) {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const [{ values }, pending, latest] = await Promise.all([
        this.settings.forLoad(load),
        this.cancellations.findOneBy({ tenantId, loadId, kind: 'load', status: 'pending' }),
        this.cancellations.findOne({
          where: { tenantId, loadId, kind: 'load' },
          order: { createdAt: 'DESC' },
        }),
      ]);
      const cancellable = LOAD_CANCELLABLE_STAGES.includes(load.status);
      return {
        canCancel: cancellable && !pending,
        blocker: pending
          ? 'A cancellation is already waiting for Loadsmart'
          : cancellable
            ? null
            : load.status === 'cancelled'
              ? 'This load is already cancelled'
              : 'A load can be cancelled only before it is Loaded',
        needsLoadsmartApproval: isLoadsmartLoad(load),
        pending,
        latest,
        cancelledAt: load.cancelledAt,
        cancelledFromStage: load.cancelledFromStage,
        reasonCodes: values.reasonCodes
          .filter((reason) => reason.active)
          .map(({ code, label }) => ({ code, label })),
      };
    } catch (error) {
      rethrow(error, 'Failed to read the cancellation options');
    }
  }

  /** Super Admin's queue: load cancellations waiting on Loadsmart loads, oldest first. */
  listPending(): Promise<LoadCancellationEntity[]> {
    return this.cancellations.find({
      where: { kind: 'load', status: 'pending' },
      relations: { load: true },
      order: { createdAt: 'ASC' },
    });
  }

  /** Super Admin approves (the load is cancelled) or rejects (it carries on) a request. */
  async decide(
    actorId: string,
    cancellationId: string,
    input: { decision: 'approved' | 'rejected'; note?: string },
  ): Promise<CancelLoadResult> {
    try {
      const row = await this.cancellations.findOneBy({ id: cancellationId, kind: 'load' });
      if (!row) throw new NotFoundError(`Cancellation ${cancellationId} not found`);
      if (row.status !== 'pending')
        throw new ConflictError(`This request is already ${row.status}`);
      const load = await this.loadRepository.findById(row.tenantId, row.loadId);
      if (!load) throw new NotFoundError(`Load ${row.loadId} not found`);
      const note = input.note?.trim() || null;
      if (input.decision === 'rejected' && !note) {
        throw new ValidationError('Say why the cancellation is rejected');
      }

      let updated = load;
      if (input.decision === 'approved') {
        // It may have been Loaded while the request waited.
        this.assertCancellable(load);
        updated = await this.cancelNow(load, actorId, 'ls_team', row.reasonCode);
      } else {
        await this.loadActivityService.record(
          row.tenantId,
          row.loadId,
          actorId,
          'LOAD_CANCEL_REJECTED',
          null,
          null,
          { cancellationId: row.id, note },
        );
      }
      const result = await this.cancellations.update(
        { id: row.id, status: 'pending' },
        { status: input.decision, decidedBy: actorId, decidedAt: this.now(), decisionNote: note },
      );
      if (!result.affected) throw new ConflictError('The request changed — reload it');
      await this.auditService.log({
        tenantId: row.tenantId,
        userId: actorId,
        action: 'LOAD_CANCEL_DECIDED',
        resourceType: 'load',
        newData: { id: row.loadId, cancellationId: row.id, decision: input.decision, note },
      });
      return {
        outcome: input.decision === 'approved' ? 'cancelled' : 'pending',
        load: updated,
        cancellation: (await this.cancellations.findOneBy({ id: row.id }))!,
      };
    } catch (error) {
      rethrow(error, 'Failed to decide the cancellation');
    }
  }

  private async cancelNow(
    load: LoadEntity,
    actorId: string,
    actorType: 'shipper' | 'ls_team',
    reasonCode: string,
  ): Promise<LoadEntity> {
    const now = this.now();
    const updated = await this.stageService.transition({
      tenantId: load.tenantId,
      loadId: load.id,
      trigger: 'load_cancelled',
      actorType,
      actorId,
      load,
      auditAction: 'LOAD_CANCELLED',
      fields: { cancelledAt: now, cancelledFromStage: load.status, updatedBy: actorId },
      metadata: { reasonCode },
    });
    await this.bidRepository.rejectAllOpen(load.tenantId, load.id, actorId);
    const memo = await this.memoRepository.findLatest(load.tenantId, load.id);
    if (memo?.status === 'sent') await this.memoRepository.markWithdrawn(memo);
    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      actorId,
      'LOAD_CANCELLED',
      load.status,
      'cancelled',
      { reasonCode },
    );
    return updated;
  }

  private assertCancellable(load: LoadEntity): void {
    if (!LOAD_CANCELLABLE_STAGES.includes(load.status)) {
      throw new ConflictError(
        load.status === 'cancelled'
          ? 'This load is already cancelled'
          : 'A load can be cancelled only before it is Loaded',
      );
    }
  }

  private async assertReason(load: LoadEntity, code: string) {
    const { values } = await this.settings.forLoad(load);
    const reason = values.reasonCodes.find((reason) => reason.code === code && reason.active);
    if (!reason) throw new ValidationError(`"${code}" is not an active reason code`);
    return reason;
  }
}
