import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository } from '../core/load.repository';
import { LoadEntity } from '../entities/load.entity';
import { LoadBidRepository } from '../bids/load-bid.repository';
import { SettingsReader } from '../../settings/settings.types';
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
import {
  LoadChecksView,
  ManualDriverCheckInput,
  ManualTruckCheckInput,
} from '../utils/load-verification.interface';
import { LoadStageService } from '../core/load-stage.service';
import { isLoadsmartLoad } from '../utils/load-stages';
import { StorageService } from '../../storage/storage.service';
import { LoadDocumentService } from '../documents/load-document.service';
import { buildMemoPdfContent, renderMemoPdf } from './memo-pdf';
import { LoadPartyNotifier } from '../utils/load-party-notifier.interface';

/** A sent memo past its hour is expired, whatever the row still says. */
export function effectiveMemoStatus(memo: LoadMemoEntity, now: Date): MemoStatus {
  return memo.status === 'sent' && memo.expiresAt <= now ? 'expired' : memo.status;
}

/**
 * The load memo on market and indent loads. Once a bid is awarded (the load stays at Bids
 * received), the transporter names the driver; the truck is checked on VAHAN and the licence on
 * Sarathi, and "the memo goes only when every detail is in and every check passes". Each memo is a
 * version (LM-<load>-v1, v2…) with its own PDF; a changed truck or driver, or a resend, is the next
 * version and supersedes the open one. It expires per the load's settings. The shipper accepts it —
 * or, on a Loadsmart load, Placement confirms it after a call — and that is the trigger into Truck
 * assigned (stage-rules.ts `memo_accepted`); the accepted PDF goes into the documents register.
 */
export class LoadMemoService {
  constructor(
    private readonly memoRepository: LoadMemoRepository,
    private readonly bidRepository: LoadBidRepository,
    private readonly loadRepository: LoadRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly verification: LoadVerificationService,
    /** Memo expiry, from the settings version the load was posted under. */
    private readonly settings: SettingsReader,
    private readonly stageService: LoadStageService,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private notifyParties?: LoadPartyNotifier;

  /** Told after every memo version is sent (the shipper gets it on WhatsApp — modules/messaging). */
  setPartyNotifier(notifier: LoadPartyNotifier): void {
    this.notifyParties = notifier;
  }

  /** The truck (checked now if it never was) and driver checks the memo waits on. */
  private async checksFor(load: LoadEntity): Promise<LoadChecksView> {
    await this.verification.ensureTruckChecked(load.tenantId, load);
    return this.verification.checksForLoad(load.tenantId, load);
  }

  private static failureSummary(checks: LoadChecksView): string {
    return checks.blockers.join('; ');
  }

  /** What the memo still waits on beyond the checks: the driver named. Null when it can go. On a
   *  Loadsmart load Placement sends it as soon as the checks pass — there is no separate
   *  verification step. */
  private static memoHold(load: LoadEntity): string | null {
    if (!load.driverName || !load.driverNumber) return 'Name the driver first';
    return null;
  }

  private async assertMemoLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    if (load.postingType === 'own_fleet') {
      throw new ConflictError('Own-fleet trips have no load memo');
    }
    // The memo follows the award, at Bids received; accepting it moves the load to Truck assigned.
    if (load.status !== 'bids_received' || (!load.route && !load.awardedParty)) {
      throw new ConflictError('The load memo goes out once a bid is awarded, before the trip');
    }
    if (load.memoAcceptedAt) throw new ConflictError('The load memo is already accepted');
    return load;
  }

  private toView(memo: LoadMemoEntity, now: Date): MemoView {
    const { load: _load, ...rest } = memo;
    return { ...rest, status: effectiveMemoStatus(memo, now) };
  }

  /** The transporter names the driver — and the truck, when the load has none yet (not sent with
   *  the bid, or the truck was cancelled). The truck is checked on VAHAN and the licence on
   *  Sarathi; "the memo goes only when every detail is in and every check passes" — otherwise
   *  what blocks it comes back. Naming a different truck or driver later sends a new version. */
  async nameDriver(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: NameDriverInput,
    asLoadsmart = false,
  ): Promise<NameDriverResult> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (isLoadsmartLoad(load) && !asLoadsmart) {
        throw new ConflictError("On a Loadsmart load, Loadsmart's placement team names the driver");
      }
      const licenceNumber = input.licenceNumber.replace(/\s+/g, '').toUpperCase();
      const vehicleNumber = input.vehicleNumber
        ? input.vehicleNumber.replace(/\s+/g, '').toUpperCase()
        : load.vehicleNumber;
      if (!vehicleNumber) throw new ValidationError('Add the truck number with the driver');
      if (vehicleNumber !== load.vehicleNumber) {
        const clash = await this.loadRepository.findActiveByVehicleNumber(
          tenantId,
          vehicleNumber,
          loadId,
        );
        if (clash) {
          throw new ConflictError(
            `Vehicle ${vehicleNumber} is already on an active load elsewhere (load ${clash.code})`,
          );
        }
      }
      const updated = await this.loadRepository.update(tenantId, loadId, {
        vehicleNumber,
        driverName: input.driverName,
        driverNumber: input.driverMobile,
        driverLicenceNumber: licenceNumber,
        driverDateOfBirth: input.dateOfBirth,
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
      if (!checks.clear || LoadMemoService.memoHold(updated)) return { memo: null, checks };
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
      const hold = LoadMemoService.memoHold(load);
      if (hold) throw new ConflictError(hold);
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

  /** The driver's licence (front, back) and the RC copy, for the memo PDF. Best effort: a file
   *  that can't be read becomes a note, never a failed memo. */
  private async driverAttachments(load: LoadEntity) {
    const labels: Record<string, string> = {
      driver_licence_front: 'Driving licence (front)',
      driver_licence_back: 'Driving licence (back)',
      rc_copy: 'RC copy',
    };
    try {
      const keys = await this.documents.currentFileKeys(
        load.tenantId,
        load.id,
        Object.keys(labels),
      );
      const items: { label: string; data: Buffer | null; note?: string }[] = [];
      for (const [docType, label] of Object.entries(labels)) {
        const key = keys[docType];
        if (!key) continue;
        try {
          const url = await this.storageService.getPresignedDownloadUrlForKey(key);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = Buffer.from(await response.arrayBuffer());
          const isJpeg = data[0] === 0xff && data[1] === 0xd8;
          const isPng = data[0] === 0x89 && data[1] === 0x50;
          items.push(
            isJpeg || isPng
              ? { label, data }
              : { label, data: null, note: 'Uploaded as a PDF — on file with Loadsmart' },
          );
        } catch {
          items.push({ label, data: null, note: 'Document on file with Loadsmart' });
        }
      }
      return items;
    } catch {
      return [];
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
    const { values } = await this.settings.forLoad(load);
    const expiresAt = new Date(sentAt.getTime() + values.memoExpiryMinutes * 60_000);
    const version = await this.memoRepository.nextVersion(load.tenantId, load.id);
    const reference = `LM-${load.code}-v${version}`;
    const point = load.loadingPoint ?? posting?.pickupLoadingPoint ?? null;
    const loadingContactName =
      loadingContact?.name ?? load.loadingContactName ?? point?.contactPersonName ?? null;
    const loadingContactPhone =
      loadingContact?.phone ?? load.loadingContactPhone ?? point?.contactPersonNumber ?? null;

    const attachments = await this.driverAttachments(load);
    const pdf = await renderMemoPdf({
      ...buildMemoPdfContent({
        reference,
        loadCode: load.code,
        sentAt,
        expiresAt,
        transporterName:
          (await this.loadRepository.findDetailById(load.tenantId, load.id))?.transporter?.name ??
          null,
        vehicleNumber: load.vehicleNumber,
        driverName: load.driverName,
        driverMobile: load.driverNumber,
        driverLicenceNumber: load.driverLicenceNumber,
        freightType: load.freightType,
        freightValue: load.freightValue,
        advancePercentage: load.advancePercentage,
        balancePercentage: load.balancePercentage,
        loadingContactName,
        loadingContactPhone,
      }),
      attachments,
    });
    const file = await this.storageService.uploadTenantFile(
      load.tenantId,
      actorId,
      {
        purpose: 'loads/memo',
        fileName: `${reference}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
      },
      pdf,
    );

    await this.memoRepository.supersedeOpen(load.tenantId, load.id);
    const memo = await this.memoRepository.create({
      tenantId: load.tenantId,
      loadId: load.id,
      version,
      reference,
      transporterId: load.transporterId,
      vehicleNumber: load.vehicleNumber,
      driverName: load.driverName,
      driverMobile: load.driverNumber,
      driverLicenceNumber: load.driverLicenceNumber,
      freightType: load.freightType,
      freightValue: load.freightValue,
      advancePercentage: load.advancePercentage,
      balancePercentage: load.balancePercentage,
      loadingContactName,
      loadingContactPhone,
      pdfFileKey: file.key,
      sentAt,
      sentBy: actorId,
      expiresAt,
    });

    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      actorId,
      'MEMO_SENT',
      null,
      memo.id,
      { reference, version, expiresAt: memo.expiresAt.toISOString() },
    );
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action: 'LOAD_MEMO_SENT',
      resourceType: 'load_memo',
      newData: {
        id: memo.id,
        loadId: load.id,
        reference,
        version,
        expiresAt: memo.expiresAt.toISOString(),
      },
    });
    await this.notifyParties?.({
      kind: 'memo_sent',
      tenantId: load.tenantId,
      loadId: load.id,
      memoId: memo.id,
    });
    return this.toView(memo, sentAt);
  }

  /** Runs the truck (VAHAN) and driver (Sarathi) checks again — after a portal couldn't be
   *  reached, or a document was fixed. When everything then passes and no memo is open, the memo
   *  goes out, as when the driver was named. */
  async rerunChecks(
    tenantId: string,
    actorId: string,
    loadId: string,
    asLoadsmart = false,
  ): Promise<NameDriverResult> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (isLoadsmartLoad(load) && !asLoadsmart) {
        throw new ConflictError("On a Loadsmart load, Loadsmart's placement team runs the checks");
      }
      if (!load.vehicleNumber) throw new ConflictError('The load has no truck number yet');
      // A manual pass (VAHAN was down) stands for this truck; re-running it would only bring the
      // outage back. A new truck number gets a fresh VAHAN check.
      if (!(await this.verification.hasManualPass(tenantId, load))) {
        await this.verification.verifyTruck(tenantId, load.id, load.vehicleNumber);
      }
      // Same for a licence an admin verified by hand while Sarathi couldn't confirm it.
      if (
        load.driverLicenceNumber &&
        load.driverDateOfBirth &&
        !(await this.verification.hasManualDriverPass(tenantId, load))
      ) {
        await this.verification.verifyDriver(tenantId, load, {
          licenceNumber: load.driverLicenceNumber,
          dateOfBirth: load.driverDateOfBirth,
        });
      }
      const checks = await this.verification.checksForLoad(tenantId, load);
      await this.loadActivityService.record(tenantId, loadId, actorId, 'CHECKS_RERUN', null, null, {
        clear: checks.clear,
        blockers: checks.blockers,
      });
      return await this.sendIfClear(load, actorId, checks);
    } catch (error) {
      rethrow(error, 'Failed to run the checks again');
    }
  }

  /** When every check passes and no memo is open, the memo goes out. */
  private async sendIfClear(
    load: LoadEntity,
    actorId: string,
    checks: LoadChecksView,
  ): Promise<NameDriverResult> {
    const latest = await this.memoRepository.findLatest(load.tenantId, load.id);
    const open = latest && effectiveMemoStatus(latest, this.now()) === 'sent';
    if (!checks.clear || open || LoadMemoService.memoHold(load)) return { memo: null, checks };
    return { memo: await this.send(load, actorId), checks };
  }

  /** VAHAN couldn't be reached for the truck, so an admin verifies it by hand (the RC checkbox,
   *  optional paper expiry dates). Then, as after a rerun, the memo goes out if everything passes.
   *  On a Loadsmart load only Loadsmart's Admin team does this. */
  async verifyTruckManually(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: ManualTruckCheckInput,
    asLoadsmart = false,
  ): Promise<NameDriverResult> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (isLoadsmartLoad(load) && !asLoadsmart) {
        throw new ConflictError("On a Loadsmart load, Loadsmart's team verifies the truck");
      }
      const check = await this.verification.recordManualTruckCheck(tenantId, load, actorId, input);
      const checks = await this.verification.checksForLoad(tenantId, load);
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'TRUCK_VERIFIED_MANUALLY',
        null,
        null,
        { vehicleNumber: load.vehicleNumber, status: check.status, failures: check.failures },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_TRUCK_VERIFIED_MANUALLY',
        resourceType: 'load_verification',
        newData: {
          id: check.id,
          loadId,
          vehicleNumber: load.vehicleNumber,
          status: check.status,
          note: input.note ?? null,
        },
      });
      return await this.sendIfClear(load, actorId, checks);
    } catch (error) {
      rethrow(error, 'Failed to verify the truck manually');
    }
  }

  /** Sarathi couldn't confirm the driver's licence (not reachable, or no match), so an admin
   *  verifies it by hand (the licence checkbox, an optional validity date). Then, as after a
   *  rerun, the memo goes out if everything passes. On a Loadsmart load only Loadsmart's Admin team
   *  does this. */
  async verifyDriverManually(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: ManualDriverCheckInput,
    asLoadsmart = false,
  ): Promise<NameDriverResult> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (isLoadsmartLoad(load) && !asLoadsmart) {
        throw new ConflictError("On a Loadsmart load, Loadsmart's team verifies the driver");
      }
      const check = await this.verification.recordManualDriverCheck(tenantId, load, actorId, input);
      const checks = await this.verification.checksForLoad(tenantId, load);
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DRIVER_VERIFIED_MANUALLY',
        null,
        null,
        { licenceNumber: load.driverLicenceNumber, status: check.status, failures: check.failures },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_DRIVER_VERIFIED_MANUALLY',
        resourceType: 'load_verification',
        newData: {
          id: check.id,
          loadId,
          licenceNumber: load.driverLicenceNumber,
          status: check.status,
          note: input.note ?? null,
        },
      });
      return await this.sendIfClear(load, actorId, checks);
    } catch (error) {
      rethrow(error, 'Failed to verify the driver manually');
    }
  }

  /** "Withdraw memo" — the open memo can no longer be accepted (a wrong truck, a broker who
   *  backed out). A new version goes out once the truck and driver are named again. On a Loadsmart
   *  load Placement withdraws it. */
  async withdraw(
    tenantId: string,
    actorId: string,
    loadId: string,
    reason: string,
    asLoadsmart = false,
  ): Promise<MemoView> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (isLoadsmartLoad(load) && !asLoadsmart) {
        throw new ConflictError(
          "On a Loadsmart load, Loadsmart's placement team withdraws the memo",
        );
      }
      const memo = await this.memoRepository.findLatest(tenantId, loadId);
      const now = this.now();
      if (!memo || effectiveMemoStatus(memo, now) !== 'sent') {
        throw new ConflictError('There is no open memo to withdraw');
      }
      if (!(await this.memoRepository.markWithdrawn(memo))) {
        throw new ConflictError('The load memo changed — reload and try again');
      }
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'MEMO_WITHDRAWN',
        null,
        memo.id,
        {
          reference: memo.reference,
          reason,
        },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_MEMO_WITHDRAWN',
        resourceType: 'load_memo',
        newData: { id: memo.id, loadId, reference: memo.reference, reason },
      });
      return this.toView({ ...memo, status: 'withdrawn' }, now);
    } catch (error) {
      rethrow(error, 'Failed to withdraw the load memo');
    }
  }

  /** A short-lived link to a stored file, for a key read from this load's own record (so no
   *  per-file access rule applies). Null when it can't be signed. */
  async downloadUrlForKey(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storageService.getPresignedDownloadUrlForKey(key);
    } catch {
      return null;
    }
  }

  /** Every memo version on the load, latest first. */
  async listVersions(tenantId: string, loadId: string): Promise<MemoView[]> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const now = this.now();
      return (await this.memoRepository.listByLoad(tenantId, loadId)).map((memo) =>
        this.toView(memo, now),
      );
    } catch (error) {
      rethrow(error, 'Failed to list the load memos');
    }
  }

  /** The load's latest truck and driver checks, and what still blocks the memo. */
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

  /** The shipper accepts the memo within its expiry, optionally changing the loading contact or
   *  point — the trigger into Truck assigned (`memo_accepted`). On a Loadsmart award this is when
   *  the load becomes a Loadsmart load. Loadsmart staff record an acceptance given on a call
   *  (`actorType` 'ls_team', Loadsmart loads only), recorded as accepted on a call. The accepted
   *  version's PDF goes into the load's documents register. */
  async accept(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AcceptMemoInput,
    actorType: 'shipper' | 'ls_team' = 'shipper',
  ): Promise<MemoView> {
    try {
      const load = await this.assertMemoLoad(tenantId, loadId);
      if (actorType === 'ls_team' && !isLoadsmartLoad(load)) {
        throw new ConflictError('Only the shipper accepts the memo on this load');
      }
      const memo = await this.memoRepository.findLatest(tenantId, loadId);
      if (!memo) throw new ConflictError('No load memo has been sent yet');

      const now = this.now();
      const status = effectiveMemoStatus(memo, now);
      if (status === 'expired') {
        await this.memoRepository.markExpired(memo);
        throw new ConflictError('The load memo has expired — send a fresh one');
      }
      if (status !== 'sent') throw new ConflictError(`The load memo is already ${status}`);

      const acceptedVia = actorType === 'ls_team' ? 'call' : 'app';
      const accepted = await this.memoRepository.accept(memo, {
        acceptedAt: now,
        acceptedBy: actorId,
        acceptedVia,
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

      await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'memo_accepted',
        actorType,
        actorId,
        load,
        auditAction: 'LOAD_MEMO_ACCEPTED',
        fields: { memoAcceptedAt: now },
        metadata: { memoId: memo.id, reference: memo.reference, acceptedVia },
        channel: acceptedVia === 'call' ? 'call' : 'web',
      });
      if (memo.pdfFileKey) {
        await this.documents.save(
          tenantId,
          load,
          { updatedBy: actorId },
          { userId: actorId, source: actorType === 'ls_team' ? 'console' : 'web' },
          [{ docType: 'load_memo', fileKey: memo.pdfFileKey }],
        );
      }
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'MEMO_ACCEPTED',
        null,
        memo.id,
        { ...input, reference: memo.reference, acceptedVia },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_MEMO_ACCEPTED',
        resourceType: 'load_memo',
        newData: { id: memo.id, loadId, reference: memo.reference, acceptedVia, ...input },
      });
      return this.toView(accepted, now);
    } catch (error) {
      rethrow(error, 'Failed to accept the load memo');
    }
  }
}
