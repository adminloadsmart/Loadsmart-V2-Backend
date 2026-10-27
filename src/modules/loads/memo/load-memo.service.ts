import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { LoadActivityService } from '../load-activity.service';
import { LoadRepository } from '../load.repository';
import { LoadEntity } from '../entities/load.entity';
import { LoadBidRepository } from '../bids/load-bid.repository';
import { MEMO_TTL_MS } from '../bids/bid-rules';
import { MemoStatus } from '../utils/loads.types';
import { LoadMemoEntity } from './load-memo.entity';
import { LoadMemoRepository } from './load-memo.repository';
import { LoadVerificationService } from '../verification/load-verification.service';
import {
  AcceptMemoInput,
  LoadingContact,
  MemoView,
  NameDriverInput,
  NameDriverResult,
} from '../utils/load-memo.interface';
import { LoadChecksView } from '../utils/load-verification.interface';

/** A sent memo past its hour is expired, whatever the row still says. */
export function effectiveMemoStatus(memo: LoadMemoEntity, now: Date): MemoStatus {
  return memo.status === 'sent' && memo.expiresAt <= now ? 'expired' : memo.status;
}

/**
 * The load memo on market and indent loads. Once a truck is assigned, the transporter names the
 * driver and the memo goes to the shipper with the truck and driver; it expires 1 hour after it
 * is sent and only the shipper can accept it, optionally changing the loading contact or point.
 * Accepting stamps LoadEntity.memoAcceptedAt — the trip can't start before that
 * (load-stages.ts's stageGateError).
 *
 * The govt-portal checks on the driver's licence that gate sending the memo arrive in Phase 3;
 * until then the memo goes as soon as the driver is named.
 */
export class LoadMemoService {
  constructor(
    private readonly memoRepository: LoadMemoRepository,
    private readonly bidRepository: LoadBidRepository,
    private readonly loadRepository: LoadRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly verification: LoadVerificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The truck (checked now if it never was) and driver checks the memo waits on. */
  private async checksFor(load: LoadEntity): Promise<LoadChecksView> {
    await this.verification.ensureTruckChecked(load.tenantId, load);
    return this.verification.checksForLoad(load.tenantId, load);
  }

  private static failureSummary(checks: LoadChecksView): string {
    return [...(checks.truck?.failures ?? []), ...(checks.driver?.failures ?? [])].join('; ');
  }

  private async assertMemoLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    if (load.sourceType === 'own_fleet') {
      throw new ConflictError('Own-fleet trips have no load memo');
    }
    if (load.status !== 'truck_assigned') {
      throw new ConflictError('The load memo is only handled while a truck is assigned');
    }
    if (load.memoAcceptedAt) throw new ConflictError('The load memo is already accepted');
    return load;
  }

  private toView(memo: LoadMemoEntity, now: Date): MemoView {
    const { load: _load, ...rest } = memo;
    return { ...rest, status: effectiveMemoStatus(memo, now) };
  }

  /** The transporter names the driver. The licence is checked on Sarathi (and the truck on
   *  VAHAN, if it never was); "the memo goes only when every check passes" — otherwise the
   *  failures come back and the transporter fixes them by naming another driver or truck.
   *  Naming a different driver later sends a fresh memo. */
  async nameDriver(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: NameDriverInput,
    asLoadsmart = false,
  ): Promise<NameDriverResult> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (load.sourceType === 'loadsmart' && !asLoadsmart) {
        throw new ConflictError("On a Loadsmart load, Loadsmart's placement team names the driver");
      }
      const licenceNumber = input.licenceNumber.replace(/\s+/g, '').toUpperCase();
      const updated = await this.loadRepository.update(tenantId, loadId, {
        driverName: input.driverName,
        driverNumber: input.driverMobile,
        driverLicenceNumber: licenceNumber,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Naming the driver failed');

      await this.loadActivityService.record(tenantId, loadId, actorId, 'DRIVER_NAMED', null, null, {
        driverName: input.driverName,
        driverMobile: input.driverMobile,
        licenceNumber,
      });
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_DRIVER_NAMED',
        resourceType: 'load',
        oldData: { id: loadId, driverName: load.driverName, driverNumber: load.driverNumber },
        newData: { id: loadId, driverName: input.driverName, driverNumber: input.driverMobile },
      });

      // Truck first: its weight decides the licence class the driver needs.
      await this.verification.ensureTruckChecked(tenantId, updated);
      await this.verification.verifyDriver(tenantId, updated, {
        licenceNumber,
        dateOfBirth: input.dateOfBirth,
      });
      const checks = await this.checksFor(updated);
      if (!checks.clear) return { memo: null, checks };
      // Loadsmart: the Verification team approves the truck and driver before the memo goes.
      if (updated.sourceType === 'loadsmart' && !updated.lsVerificationApprovedAt) {
        return { memo: null, checks };
      }
      return { memo: await this.send(updated, actorId), checks };
    } catch (error) {
      rethrow(error, 'Failed to name the driver');
    }
  }

  /** Sends a fresh memo for the load's current truck and driver — e.g. after the last one expired. */
  async resend(
    tenantId: string,
    actorId: string,
    loadId: string,
    loadingContact?: LoadingContact,
  ): Promise<MemoView> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (load.sourceType === 'loadsmart' && !load.lsVerificationApprovedAt) {
        throw new ConflictError(
          "Loadsmart's verification team has to approve the truck and driver first",
        );
      }
      const checks = await this.checksFor(load);
      if (!checks.clear) {
        throw new ConflictError(
          `The load memo can't go out until these checks pass: ${LoadMemoService.failureSummary(checks)}`,
          { checks },
        );
      }
      return await this.send(load, actorId, loadingContact);
    } catch (error) {
      rethrow(error, 'Failed to send the load memo');
    }
  }

  private async send(
    load: LoadEntity,
    actorId: string,
    loadingContact?: LoadingContact,
  ): Promise<MemoView> {
    if (!load.vehicleNumber) throw new ConflictError('The load has no truck number yet');
    if (!load.driverName || !load.driverNumber) {
      throw new ConflictError('Name the driver before sending the load memo');
    }
    const posting = load.postingId
      ? await this.bidRepository.findPosting(load.tenantId, load.postingId)
      : null;
    const sentAt = this.now();

    await this.memoRepository.expireOpen(load.tenantId, load.id);
    const memo = await this.memoRepository.create({
      tenantId: load.tenantId,
      loadId: load.id,
      transporterId: load.transporterId,
      vehicleNumber: load.vehicleNumber,
      driverName: load.driverName,
      driverMobile: load.driverNumber,
      loadingContactName:
        loadingContact?.name ?? posting?.pickupLoadingPoint?.contactPersonName ?? null,
      loadingContactPhone:
        loadingContact?.phone ?? posting?.pickupLoadingPoint?.contactPersonNumber ?? null,
      sentAt,
      sentBy: actorId,
      expiresAt: new Date(sentAt.getTime() + MEMO_TTL_MS),
    });

    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      actorId,
      'MEMO_SENT',
      null,
      memo.id,
      { expiresAt: memo.expiresAt.toISOString() },
    );
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action: 'LOAD_MEMO_SENT',
      resourceType: 'load_memo',
      newData: { id: memo.id, loadId: load.id, expiresAt: memo.expiresAt.toISOString() },
    });
    return this.toView(memo, sentAt);
  }

  /** The load's latest truck and driver checks — only failures block. */
  async getChecks(tenantId: string, loadId: string): Promise<LoadChecksView> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      return await this.verification.checksForLoad(tenantId, load);
    } catch (error) {
      rethrow(error, 'Failed to read the load checks');
    }
  }

  async getCurrent(tenantId: string, loadId: string): Promise<MemoView> {
    try {
      const memo = await this.memoRepository.findLatest(tenantId, loadId);
      if (!memo) throw new NotFoundError(`Load ${loadId} has no load memo yet`);
      const now = this.now();
      if (effectiveMemoStatus(memo, now) === 'expired' && memo.status === 'sent') {
        await this.memoRepository.markExpired(memo);
      }
      return this.toView(memo, now);
    } catch (error) {
      rethrow(error, 'Failed to fetch the load memo');
    }
  }

  /** The shipper accepts the memo within its hour, optionally changing the loading contact or
   *  point. */
  async accept(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AcceptMemoInput,
  ): Promise<MemoView> {
    try {
      await this.assertMemoLoad(tenantId, loadId);
      const memo = await this.memoRepository.findLatest(tenantId, loadId);
      if (!memo) throw new ConflictError('No load memo has been sent yet');

      const now = this.now();
      const status = effectiveMemoStatus(memo, now);
      if (status === 'expired') {
        await this.memoRepository.markExpired(memo);
        throw new ConflictError('The load memo has expired — send a fresh one');
      }
      if (status !== 'sent') throw new ConflictError(`The load memo is already ${status}`);

      const accepted = await this.memoRepository.accept(memo, {
        acceptedAt: now,
        acceptedBy: actorId,
        ...(input.loadingContactName !== undefined
          ? { loadingContactName: input.loadingContactName }
          : {}),
        ...(input.loadingContactPhone !== undefined
          ? { loadingContactPhone: input.loadingContactPhone }
          : {}),
        ...(input.loadingPointNote !== undefined
          ? { loadingPointNote: input.loadingPointNote }
          : {}),
      });
      if (!accepted) throw new ConflictError('The load memo changed — reload and try again');

      await this.loadRepository.update(tenantId, loadId, {
        memoAcceptedAt: now,
        updatedBy: actorId,
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'MEMO_ACCEPTED',
        null,
        memo.id,
        { ...input },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_MEMO_ACCEPTED',
        resourceType: 'load_memo',
        newData: { id: memo.id, loadId, ...input },
      });
      return this.toView(accepted, now);
    } catch (error) {
      rethrow(error, 'Failed to accept the load memo');
    }
  }
}
