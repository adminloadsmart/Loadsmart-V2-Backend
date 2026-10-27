import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  rethrow,
} from '../../shared/errors';
import { humanizeStatus } from '../../shared/utils/humanize';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { StorageService } from '../storage/storage.service';
import { msg } from '../../shared/i18n/translate';
import { redisManager } from '../../db/redis';
import { MAX_OTP_ATTEMPTS } from '../auth/auth.constants';
import { paginate, Paginated, PaginationInput } from '../../shared/utils/pagination';
import { LoadRepository, UpdateLoadData } from './load.repository';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadIssueRepository } from './load-issue.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadStageService } from './load-stage.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { LoadIssueReportEntity } from './entities/load-issue-report.entity';
import {
  COMPLETED_LOAD_STATUSES,
  DELIVERED_LOAD_STATUSES,
  deliveredStageFor,
  UNLOADED_LOAD_STATUSES,
  ManualTrackingStatus,
  PodReviewDecision,
} from './utils/loads.types';
import { hasLoadingPapers } from './utils/load-stages';
import { LoadActivityWithActor } from './utils/load-activity.interface';
import { ReportLoadIssueInput } from './utils/load-issue.interface';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  EwayBillExpiry,
  ListLoadsInput,
  UploadPodInput,
} from './utils/load.interface';
import { BreakdownReportedNotifier } from '../notifications/breakdown-alerts';
import { LoadEventNotifier } from '../notifications/notifications.interface';
import {
  buildNextAction,
  buildStepper,
  LoadPapers,
  toLoadPapers,
  toTripDoneDetail,
  toTripListRow,
  TripDoneDetail,
  TripListRow,
  TripNextAction,
  TripStepperStep,
  TripIncident,
  buildIncident,
} from './utils/trip-view';
import { DEFAULT_LOCALE, Locale } from '../../shared/i18n/locales';

const EWAY_BILL_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2-hour expiry alert

export interface ListTripsResult extends Paginated<TripListRow> {
  /** Tab counts for the whole tenant (scoped by the same non-group filters as the list itself),
   *  independent of which `group` — if any — the caller requested. */
  counts: { active: number; completed: number };
}

/** Driver-app "Trips Done" screen — a dedicated, always-completed-only view of a single driver's
 *  own trip history, separate from the general list() above (which serves the tenant-wide Trips
 *  Home page and accepts arbitrary status/group/sourceType filters). See
 *  driver-portal.controller.ts's getMyTripsDone. Amount/paid and per-trip distance are
 *  deliberately not here yet — own-fleet loads (what every driver-app caller has) carry no
 *  driver-payout amount anywhere in this build, and there's no distance-capture point wired up
 *  yet either; both are follow-up work. */
export interface TripsDoneResult extends Paginated<TripListRow> {
  totalTrips: number;
  /** Percentage (0-100) of completed trips with a confirmed E-POD on file. */
  epodVerifiedPercentage: number;
}

/** Raw storage keys for a load's documents — `load` carries these same fields as download URLs. */
export interface LoadDocumentKeys {
  invoiceFileKey: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
  podFileKey: string | null;
  podBackFileKey: string | null;
  weighingSlipFileKey: string | null;
  loadingPhotoFileKeys: string[] | null;
}

export interface LoadDetailView {
  load: LoadEntity;
  ownerPhoneNumber: string | null;
  dispatchPhoneNumber: string | null;
  documentKeys: LoadDocumentKeys;
  timeline: LoadActivityWithActor[];
  payments: LoadPaymentEntity[];
  ewayBillExpiry: EwayBillExpiry;
  stepper: TripStepperStep[];
  nextAction: TripNextAction;
  /** Newest unresolved driver-reported issue, or null. `incident.halted` means the trip is on hold. */
  incident: TripIncident | null;
}

// TEMPORARY: the receiver code is a fixed value until a real SMS template/provider is wired in —
// no SMS is sent. Replace sendPodReceiverCode's no-op and the check in uploadPod together.
const POD_RECEIVER_STATIC_OTP = '1234';
/** How long a verified receiver number stays valid for the final E-POD submit. */
const POD_RECEIVER_VERIFIED_TTL_SECONDS = 30 * 60;
const podReceiverVerifiedKey = (loadId: string, mobile: string) =>
  `pod-receiver-verified:${loadId}:${mobile}`;
const podReceiverAttemptsKey = (loadId: string, mobile: string) =>
  `pod-receiver-attempts:${loadId}:${mobile}`;

/** A Loadsmart load's delivery issue is settled through its claim (claim value, then settle —
 *  loadsmart-ops LsShipperService), never directly; that path passes `viaClaim`. */
function assertNotLoadsmartClaim(load: LoadEntity, viaClaim: boolean): void {
  if (load.sourceType === 'loadsmart' && !viaClaim) {
    throw new ConflictError('On a Loadsmart load, settle the claim instead');
  }
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly authService: AuthService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly loadIssueRepository: LoadIssueRepository,
    private readonly transporterService: TransporterService,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly stageService: LoadStageService,
    // LS_N_0054 — optional; only queues a notification after the existing logic and never throws
    // (see notifications/breakdown-alerts.ts).
    private readonly onBreakdownReported?: BreakdownReportedNotifier,
    // Stage handoffs, e-way bill expiry, E-POD uploaded, advance due — optional; only queues a
    // notification after the existing logic and never throws (see notifications/load-alerts.ts).
    private readonly onLoadEvent?: LoadEventNotifier,
  ) {}

  async assertExists(tenantId: string, id: string): Promise<LoadEntity> {
    try {
      const load = await this.repository.findById(tenantId, id);
      if (!load) throw new NotFoundError(`Load ${id} not found`);
      return load;
    } catch (error) {
      rethrow(error, 'Failed to verify load exists');
    }
  }

  /**
   * Load Assignment — market and indent loads. Own-fleet loads never reach this: vehicle+driver
   * are already known at Dispatch Planning / posting, so they're created directly in
   * `truck_assigned`. Market and indent loads pick their transporter, vehicle number, driver
   * number and agreed freight here — none of that is known at planning time (Plan Dispatch v2.0
   * R-16). Moves the load to Truck assigned, from Created or Bids received.
   */
  async assign(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AssignLoadInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.sourceType === 'own_fleet') {
        throw new ConflictError(
          'Own-fleet loads are assigned at Dispatch Planning, not through this endpoint',
        );
      }
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('Only a load that has no truck yet can be assigned');
      }

      if (!input.transporterId) throw new ValidationError('transporterId is required');
      await this.transporterService.getTransporter(tenantId, input.transporterId);
      if (!input.vehicleNumber?.trim()) throw new ValidationError('vehicleNumber is required');
      // if (!input.driverNumber?.trim()) throw new ValidationError('driverNumber is required');
      if (!input.freightType) throw new ValidationError('freightType is required');

      // C-07 — this plate can't already be on another live load, own-fleet or market. Own-fleet
      // duplicate use is caught earlier by vehicleId-based C-01/C-02 at Dispatch Planning; this
      // is the same guarantee for a market load's free-text vehicle number. No override — same
      // as C-02, a truck cannot physically be on two active trips at once.
      const vehicleNumber = input.vehicleNumber.trim().toUpperCase();
      const clash = await this.repository.findActiveByVehicleNumber(
        tenantId,
        vehicleNumber,
        loadId,
      );
      if (clash) {
        throw new ConflictError(
          `Vehicle ${vehicleNumber} is already on an active load elsewhere (load ${clash.code}, status ${humanizeStatus(clash.status)})`,
        );
      }

      // The agreed rate — defaults to the target rate captured at planning if the caller doesn't
      // override it (e.g. the counter-offer negotiation landed on the original target).
      const freightValue =
        input.freightValue !== undefined ? String(input.freightValue) : load.expectedRate;

      const driverNumber = input.driverNumber?.trim() ?? null;
      const driverName = input.driverName?.trim() ?? null;
      return await this.stageService.transition({
        tenantId,
        loadId,
        to: 'truck_assigned',
        actorId,
        load,
        auditAction: 'LOAD_ASSIGNED',
        fields: {
          transporterId: input.transporterId,
          vehicleNumber,
          driverNumber,
          driverName,
          freightType: input.freightType,
          freightValue,
        },
        metadata: { vehicleNumber, driverNumber, driverName },
      });
    } catch (error) {
      rethrow(error, 'Failed to assign load');
    }
  }

  /** Validates a document was uploaded via the storage module for the expected purpose and is
   *  confirmed, before attaching its key to the load — same pattern as
   *  driver/driver.service.ts's assertDriverDlUpload. */
  private async assertLoadDocumentUpload(
    tenantId: string,
    actorRole: string,
    key: string,
    expectedPurpose: string,
  ): Promise<void> {
    try {
      const { file } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
      if (file.purpose !== expectedPurpose) {
        throw new ValidationError(`File ${key} was not uploaded for purpose ${expectedPurpose}`);
      }
      if (file.status !== 'confirmed') {
        throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
      }
    } catch (error) {
      rethrow(error, 'Failed to verify uploaded load document');
    }
  }

  /** Resolves a load's storage-key document fields into fresh, short-lived download URLs. */
  private async withDocumentDownloadUrls(
    tenantId: string,
    actorRole: string,
    load: LoadEntity,
  ): Promise<LoadEntity> {
    const resolve = async (key: string): Promise<string> =>
      (await this.resolveDownloadUrl(tenantId, actorRole, key)) ?? key;
    const resolveNullable = async (key: string | null) => (key ? resolve(key) : key);
    return {
      ...load,
      invoiceFileKey: await resolveNullable(load.invoiceFileKey),
      ewayBillFileKey: await resolveNullable(load.ewayBillFileKey),
      elrFileKey: await resolveNullable(load.elrFileKey),
      podFileKey: await resolveNullable(load.podFileKey),
      podBackFileKey: await resolveNullable(load.podBackFileKey),
      weighingSlipFileKey: await resolveNullable(load.weighingSlipFileKey),
      loadingPhotoFileKeys: load.loadingPhotoFileKeys
        ? await Promise.all(load.loadingPhotoFileKeys.map(resolve))
        : load.loadingPhotoFileKeys,
    };
  }

  /** A fresh signed download URL for a stored file key, or null when the file isn't a confirmed
   *  upload (StorageService hands back no URL for pending/failed files). */
  private async resolveDownloadUrl(
    tenantId: string,
    actorRole: string,
    key: string,
  ): Promise<string | null> {
    const { downloadUrl } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
    return downloadUrl;
  }

  /** Shared by confirmLoading and updateDocuments — verifies whichever document fields were
   *  submitted this call (previously-saved keys were already verified as confirmed uploads for
   *  the right purpose when first submitted) and returns the row fields to persist. Doesn't touch
   *  status/completeness — callers own that. */
  private async buildDocumentFields(
    tenantId: string,
    actorId: string,
    actorRole: string,
    load: LoadEntity,
    input: ConfirmLoadingInput,
  ): Promise<UpdateLoadData> {
    // C-04 — LR numbers are statutory and can never repeat, checked across every load in the
    // tenant regardless of status. Blocking, no override. Only checked when this call is
    // actually setting/changing the number — otherwise a partial-submission caller resubmitting
    // its own already-stored elrNumber would self-clash against the row it's about to update.
    const nextElrNumber = input.elrNumber?.trim();
    if (nextElrNumber && nextElrNumber !== load.elrNumber) {
      const clash = await this.repository.findByElrNumber(tenantId, nextElrNumber);
      if (clash) {
        throw new ConflictError(
          `E-LR number "${nextElrNumber}" is already used on load ${clash.code}`,
        );
      }
    }

    if (input.invoiceFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.invoiceFileKey,
        'loads/invoice',
      );
    }
    if (input.ewayBillFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.ewayBillFileKey,
        'loads/eway-bill',
      );
    }
    if (input.elrFileKey) {
      await this.assertLoadDocumentUpload(tenantId, actorRole, input.elrFileKey, 'trips/lr');
    }
    if (input.loadingPhotoFileKeys) {
      for (const key of input.loadingPhotoFileKeys) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, key, 'loads/loading-photo');
      }
    }
    if (input.weighingSlipFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.weighingSlipFileKey,
        'loads/weighing-slip',
      );
    }

    const fields: UpdateLoadData = { updatedBy: actorId };
    if (input.invoiceNumber !== undefined) fields.invoiceNumber = input.invoiceNumber.trim();
    if (input.invoiceFileKey !== undefined) fields.invoiceFileKey = input.invoiceFileKey;
    if (input.ewayBillNumber !== undefined) fields.ewayBillNumber = input.ewayBillNumber.trim();
    if (input.ewayBillFileKey !== undefined) {
      fields.ewayBillFileKey = input.ewayBillFileKey;
      // Stamped when the e-way bill is actually uploaded (this call), not whenever the last
      // document happens to land — getEwayBillExpiry's 2-hour clock runs from generation time.
      fields.ewayBillGeneratedAt = new Date();
    }
    if (input.elrNumber !== undefined) fields.elrNumber = nextElrNumber ?? null;
    if (input.elrFileKey !== undefined) fields.elrFileKey = input.elrFileKey;
    // Non-mandatory — whole-array replace, not accumulated, same as every field above.
    if (input.loadingPhotoFileKeys !== undefined) {
      fields.loadingPhotoFileKeys = input.loadingPhotoFileKeys;
    }
    if (input.weighingSlipFileKey !== undefined) {
      fields.weighingSlipFileKey = input.weighingSlipFileKey;
    }
    return fields;
  }

  private async recordDocumentUpload(
    tenantId: string,
    loadId: string,
    actorId: string,
    input: ConfirmLoadingInput,
  ): Promise<void> {
    const uploadedMetadata: Record<string, unknown> = {};
    if (input.invoiceNumber !== undefined) uploadedMetadata.invoiceNumber = input.invoiceNumber;
    if (input.ewayBillNumber !== undefined) uploadedMetadata.ewayBillNumber = input.ewayBillNumber;
    if (input.elrFileKey !== undefined) uploadedMetadata.elrNumber = input.elrNumber ?? null;
    await this.loadActivityService.record(
      tenantId,
      loadId,
      actorId,
      'DOCUMENT_UPLOADED',
      null,
      null,
      uploadedMetadata,
    );
  }

  /**
   * Attach/replace load documents (invoice/e-way bill/E-LR/loading photos/weighing slip) at any
   * point in the load's lifecycle except once closed (terminal). Useful for correcting or adding
   * a document after the fact (e.g. a wrong invoice number). Like confirmLoading, a load at the
   * loading point moves to Loaded as soon as the three loading papers are all on it — "3 papers
   * move it to Loaded" holds whichever endpoint delivered the last one.
   *
   * `driverOwnerId` is set only by driver-portal's self-service call — same ownership-check-as-
   * 404 convention as confirmLoading/uploadPod below.
   */
  async updateDocuments(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (load.status === 'closed') {
        throw new ConflictError('Documents cannot be changed once a load is closed');
      }

      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);
      const updated = await this.repository.update(tenantId, loadId, fields);
      if (!updated) throw new ConflictError('Updating documents failed');

      await this.recordDocumentUpload(tenantId, loadId, actorId, input);
      await this.notifyEwayBillGenerated(tenantId, loadId, fields, updated);

      return await this.advanceIfPapersComplete(tenantId, actorId, updated, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to update load documents');
    }
  }

  /** Ops or the assigned driver attaches invoice/e-way bill/signed LR (mandatory — but only
   *  whichever aren't already on the load) plus optional loading photos/weighing slip at the
   *  loading point. Documents may be submitted one at a time or all together; the load moves to
   *  Loaded once all three papers end up on the row, whether accumulated across calls or already
   *  present from an earlier caller (advanceIfPapersComplete).
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — same ownership-check-as-
   *  404 convention as uploadPod/reportIssue. */
  async confirmLoading(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (load.status !== 'reached_loading') {
        throw new ConflictError('Loading papers can only be confirmed at the loading point');
      }

      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);

      // Persist whatever arrived this call, then decide completeness from the fresh, post-write
      // row rather than an in-memory merge of the pre-write read: that's what lets two concurrent
      // calls, each landing one of the last two missing papers, both see the full set.
      const updated = await this.repository.update(tenantId, loadId, fields);
      if (!updated) throw new ConflictError('Confirming loading failed');

      await this.recordDocumentUpload(tenantId, loadId, actorId, input);
      await this.notifyEwayBillGenerated(tenantId, loadId, fields, updated);

      return await this.advanceIfPapersComplete(tenantId, actorId, updated, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to confirm loading');
    }
  }

  /** A (re)generated e-way bill gets its own expiry alert; an older bill's alert drops itself. */
  private async notifyEwayBillGenerated(
    tenantId: string,
    loadId: string,
    fields: UpdateLoadData,
    updated: LoadEntity,
  ): Promise<void> {
    if (!fields.ewayBillGeneratedAt || !updated.ewayBillGeneratedAt) return;
    const { expiresAt } = this.getEwayBillExpiry(updated);
    if (!expiresAt) return;
    await this.onLoadEvent?.({
      kind: 'eway_bill_generated',
      tenantId,
      loadId,
      generatedAt: updated.ewayBillGeneratedAt,
      expiresAt: new Date(expiresAt),
    });
  }

  /** "3 papers move it to Loaded": a load at the loading point moves to Loaded once invoice,
   *  e-way bill and signed LR are all on it. The stage service's conditional update is the race
   *  guard — if a concurrent call already moved it, this one just returns the current row. */
  private async advanceIfPapersComplete(
    tenantId: string,
    actorId: string,
    load: LoadEntity,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    if (load.status !== 'reached_loading' || !hasLoadingPapers(load)) return load;
    // On a Loadsmart load the truck waits for the papers to be approved
    // (loadsmart-ops approvePapers) — complete papers alone don't move it.
    if (load.sourceType === 'loadsmart') return load;
    try {
      return await this.stageService.transition({
        tenantId,
        loadId: load.id,
        to: 'loaded',
        actorId,
        driverOwnerId,
        load,
        auditAction: 'LOAD_LOADING_CONFIRMED',
        fields: { loadingConfirmedBy: actorId },
      });
    } catch (error) {
      if (error instanceof ConflictError) return this.assertExists(tenantId, load.id);
      throw error;
    }
  }

  /** Computed on read — no scheduler/queue infra exists in this repo yet (src/jobs/queue-registry.ts
   *  is a no-op placeholder), so the 2-hour e-way-bill expiry is a derived flag, not a
   *  pushed notification. // TODO: wire a real alert once queue infra exists. */
  getEwayBillExpiry(load: LoadEntity): EwayBillExpiry {
    if (!load.ewayBillGeneratedAt) return { expiresAt: null, expired: false };
    const expiresAt = new Date(load.ewayBillGeneratedAt.getTime() + EWAY_BILL_VALIDITY_MS);
    const stillMoving = !UNLOADED_LOAD_STATUSES.includes(load.status) && load.status !== 'closed';
    return { expiresAt: expiresAt.toISOString(), expired: stillMoving && new Date() > expiresAt };
  }

  /** Manual stage mark — Start trip, Reached loading point, left for the drop, Reached unloading
   *  point. There is no live tracking yet, so these move the load through Execution; the stage
   *  service rejects skipping ahead or moving backward.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — when present, the caller
   *  must be this load's own assigned driver (masked as not-found otherwise, same "no IDOR
   *  surface" convention driver-portal's getMyLoads already follows). */
  async updateStatus(
    tenantId: string,
    actorId: string,
    loadId: string,
    toStatus: ManualTrackingStatus,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      await this.assertNotHalted(tenantId, loadId);
      const moved = await this.stageService.transition({
        tenantId,
        loadId,
        to: toStatus,
        actorId,
        driverOwnerId,
        load,
      });
      // Papers attached on the way in move the load to Loaded as soon as it reaches the gate.
      return await this.advanceIfPapersComplete(tenantId, actorId, moved, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to update load status');
    }
  }

  /** Step 1 of the driver-app delivery flow: sends a 4-digit code to the receiver's phone.
   *  Ownership-checked like uploadPod; the code is verified there, at final submission. */
  async sendPodReceiverCode(
    tenantId: string,
    loadId: string,
    mobile: string,
    driverOwnerId: string,
  ): Promise<void> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }
      // Static code for now — nothing to send; see POD_RECEIVER_STATIC_OTP. A fresh send always
      // gets a fresh guess budget and invalidates any earlier verification of this number.
      await redisManager.delete(podReceiverAttemptsKey(loadId, mobile));
      await redisManager.delete(podReceiverVerifiedKey(loadId, mobile));
    } catch (error) {
      rethrow(error, 'Failed to send receiver code');
    }
  }

  /** Step 1b of the driver-app delivery flow: checks the code the receiver read out. On success
   *  the number is marked verified (Redis, short TTL) for this load, and uploadPod then requires
   *  that mark whenever a receiver mobile is submitted. */
  async verifyPodReceiverCode(
    tenantId: string,
    loadId: string,
    mobile: string,
    code: string,
    driverOwnerId: string,
  ): Promise<void> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }
      const attempts = await redisManager.incr(
        podReceiverAttemptsKey(loadId, mobile),
        POD_RECEIVER_VERIFIED_TTL_SECONDS,
      );
      if (attempts > MAX_OTP_ATTEMPTS) {
        throw new AuthenticationError(msg('errors.otp.tooManyAttempts'));
      }
      if (code !== POD_RECEIVER_STATIC_OTP) {
        throw new AuthenticationError(msg('errors.otp.invalid'));
      }
      await redisManager.delete(podReceiverAttemptsKey(loadId, mobile));
      await redisManager.set(
        podReceiverVerifiedKey(loadId, mobile),
        '1',
        POD_RECEIVER_VERIFIED_TTL_SECONDS,
      );
    } catch (error) {
      rethrow(error, 'Failed to verify receiver code');
    }
  }

  /** The E-POD is taken at the drop. A load still marked on its way to the drop is accepted too
   *  — with no live tracking the driver may not have marked the arrival — and uploadPod marks it
   *  reached first. A rejected E-POD can be resubmitted from either delivered stage. */
  private canRecordPod(load: LoadEntity): boolean {
    return (
      load.status === 'in_transit_unloading' ||
      load.status === 'reached_unloading' ||
      (DELIVERED_LOAD_STATUSES.includes(load.status) && load.podStatus === 'rejected')
    );
  }

  /** The delivery receipt — POD front and back, receiver name/mobile, and quantity received are
   *  required; receiver designation and sealStatus are optional. "The POD decides how it was
   *  delivered": nothing noted moves the load to Delivered without issues; damage, shortage or
   *  pilferage to Delivered with issues, until settleDeliveryIssue. Closing waits on staff's
   *  E-POD review (reviewPod) and, for market loads, the payments.
   *
   *  shortageOrDamage is the driver-app screen's cargo-condition-on-arrival field — like
   *  sealStatus, never a hard block (no exceptions/escalations module exists yet to route it to);
   *  just recorded on the load's activity/audit trail. damagePhotoKey is required (validated
   *  above, and enforced server-side in load.validators.ts) whenever shortageOrDamage is
   *  'damage'/'both'; numberOfTonnesShort is accepted unconditionally regardless of
   *  shortageOrDamage's value.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — see updateStatus's doc
   *  comment above for the ownership-check/audit-FK reasoning; identical here. */
  async uploadPod(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: UploadPodInput,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const isResubmission =
        DELIVERED_LOAD_STATUSES.includes(load.status) && load.podStatus === 'rejected';
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }

      // Driver-only receiver verification: a receiver mobile must have been verified via verifyPodReceiverCode;
      // no mobile means the receiver has no phone and the POD photo alone is the proof. A
      // resubmission with the same, already-verified mobile doesn't need a fresh code.
      let podReceiverVerifiedAt: Date | null = null;
      if (driverOwnerId && input.podReceiverMobile) {
        const alreadyVerified =
          isResubmission &&
          load.podReceiverVerifiedAt &&
          load.podReceiverMobile === input.podReceiverMobile;
        if (alreadyVerified) {
          podReceiverVerifiedAt = load.podReceiverVerifiedAt;
        } else {
          const verifiedKey = podReceiverVerifiedKey(loadId, input.podReceiverMobile);
          if (!(await redisManager.get(verifiedKey))) {
            throw new ValidationError(
              'Receiver mobile must be verified (receiver-code/verify) before submitting E-POD',
            );
          }
          await redisManager.delete(verifiedKey);
          podReceiverVerifiedAt = new Date();
        }
      }

      // Driver-submitted shortage is worked out here, not trusted from the client: planned minus
      // unloaded, never negative.
      let numberOfTonnesShort = input.numberOfTonnesShort;
      let shortageOrDamage = input.shortageOrDamage;
      if (driverOwnerId) {
        const short = Math.max(
          0,
          Math.round((Number(load.plannedCapacityTonnes) - input.podQuantityReceived) * 100) / 100,
        );
        numberOfTonnesShort = short;
        if (short > 0) {
          if (!shortageOrDamage || shortageOrDamage === 'none') shortageOrDamage = 'shortage';
          else if (shortageOrDamage === 'damage') shortageOrDamage = 'both';
        }
      }

      await this.assertLoadDocumentUpload(tenantId, actorRole, input.podFileKey, 'trips/pod');
      await this.assertLoadDocumentUpload(tenantId, actorRole, input.podBackFileKey, 'trips/pod');
      if (input.damagePhotoKey) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, input.damagePhotoKey, 'trips/pod');
      }

      const target = deliveredStageFor(shortageOrDamage);
      const podFields: UpdateLoadData = {
        // Only stamp deliveredAt on the first upload — a resubmission after rejection doesn't
        // change when the truck physically arrived.
        ...(isResubmission ? {} : { deliveredAt: new Date() }),
        podFileKey: input.podFileKey,
        podBackFileKey: input.podBackFileKey,
        podReceiverName: input.podReceiverName,
        podReceiverMobile: input.podReceiverMobile ?? null,
        podReceiverVerifiedAt,
        podReceiverDesignation: input.podReceiverDesignation ?? null,
        podQuantityReceived: String(input.podQuantityReceived),
        sealStatus: input.sealStatus ?? null,
        shortageOrDamage: shortageOrDamage ?? null,
        numberOfTonnesShort: numberOfTonnesShort === undefined ? null : String(numberOfTonnesShort),
        damagePhotoKey: input.damagePhotoKey ?? null,
        podRemarks: input.podRemarks ?? null,
        // Every upload (first or resubmission) restarts staff review from scratch.
        podStatus: 'pending',
        podRejectionReason: null,
        // A fresh issue on the POD needs a fresh settlement.
        ...(target === 'delivered_with_issues'
          ? {
              deliveryIssueSettledAt: null,
              deliveryIssueSettledBy: null,
              deliveryIssueSettlementNote: null,
            }
          : {}),
      };

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_UPLOADED',
        null,
        null,
        {
          pod: true,
          sealStatus: input.sealStatus,
          shortageOrDamage,
          receiverVerified: Boolean(podReceiverVerifiedAt),
        },
      );

      let current = load;
      if (current.status === 'in_transit_unloading') {
        current = await this.stageService.transition({
          tenantId,
          loadId,
          to: 'reached_unloading',
          actorId,
          driverOwnerId,
          load: current,
        });
      }
      let updated: LoadEntity;
      if (current.status === target) {
        // A resubmission that lands on the same delivered stage — only the POD changes.
        const saved = await this.repository.update(tenantId, loadId, {
          ...podFields,
          updatedBy: actorId,
        });
        if (!saved) throw new ConflictError('Recording E-POD failed');
        updated = saved;
      } else {
        updated = await this.stageService.transition({
          tenantId,
          loadId,
          to: target,
          actorId,
          driverOwnerId,
          load: current,
          fields: podFields,
          auditAction: driverOwnerId ? 'LOAD_POD_RECORDED_BY_DRIVER' : 'LOAD_POD_RECORDED',
          metadata: { sealStatus: input.sealStatus, shortageOrDamage },
        });
      }

      await this.onLoadEvent?.({ kind: 'pod_uploaded', tenantId, loadId, at: new Date() });

      // No auto-close here — podStatus is 'pending' until staff reviews it via reviewPod.
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to upload E-POD');
    }
  }

  /** Staff decision on a pending E-POD (PATCH /loads/:loadId/pod/review). Accepting an own-fleet
   *  load closes it immediately (no payment gate — R-17); accepting a market load only closes it
   *  if both advance and balance are already paid, otherwise load-payment.service.ts's
   *  recordBalance closes it later once the second payment lands (see that method's own doc
   *  comment for why the two checks together never double-close or leave a closeable load
   *  stuck). A load still Delivered with issues closes only once the issue is settled
   *  (settleDeliveryIssue). Rejecting leaves the load where it is — the driver resubmits via
   *  uploadPod above, which resets podStatus back to 'pending'. */
  async reviewPod(
    tenantId: string,
    actorId: string,
    loadId: string,
    decision: PodReviewDecision,
    reason?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.podStatus !== 'pending') {
        throw new ConflictError('This load has no E-POD pending review');
      }
      if (decision === 'rejected' && !reason) {
        throw new ValidationError('reason is required when rejecting an E-POD');
      }

      const updated = await this.repository.update(tenantId, loadId, {
        podStatus: decision,
        podRejectionReason: decision === 'rejected' ? reason! : null,
        podReviewedAt: new Date(),
        podReviewedBy: actorId,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Reviewing E-POD failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'POD_REVIEWED',
        'pending',
        decision,
        decision === 'rejected' ? { reason } : null,
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: decision === 'accepted' ? 'LOAD_POD_ACCEPTED' : 'LOAD_POD_REJECTED',
        resourceType: 'load',
        oldData: { id: loadId, podStatus: 'pending' },
        newData: {
          id: loadId,
          podStatus: decision,
          ...(decision === 'rejected' ? { reason } : {}),
        },
      });

      if (decision === 'accepted') {
        return await this.stageService.closeIfReady(tenantId, actorId, updated);
      }
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to review E-POD');
    }
  }

  /** Loadsmart's Verification team approved the truck and driver — the memo can go out. */
  async markLoadsmartVerified(tenantId: string, actorId: string, loadId: string): Promise<void> {
    await this.repository.update(tenantId, loadId, {
      lsVerificationApprovedAt: new Date(),
      updatedBy: actorId,
    });
  }

  /** Loadsmart's Tracking team approved the loading papers — the load can move to Loaded. */
  async markLoadsmartPapersApproved(
    tenantId: string,
    actorId: string,
    loadId: string,
  ): Promise<void> {
    await this.repository.update(tenantId, loadId, {
      lsPapersApprovedAt: new Date(),
      updatedBy: actorId,
    });
  }

  /** Delivered with issues -> Delivered without issues: damage, shortage or pilferage noted on
   *  the POD has been settled (own fleet: handled internally; market/indent: settled with the
   *  transporter). Then closes the load if nothing else is pending. */
  async settleDeliveryIssue(
    tenantId: string,
    actorId: string,
    loadId: string,
    note: string,
    viaClaim = false,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      assertNotLoadsmartClaim(load, viaClaim);
      if (load.status !== 'delivered_with_issues') {
        throw new ConflictError('This load has no delivery issue to settle');
      }
      const settled = await this.stageService.transition({
        tenantId,
        loadId,
        to: 'delivered_ok',
        actorId,
        load,
        auditAction: 'LOAD_DELIVERY_ISSUE_SETTLED',
        fields: {
          deliveryIssueSettledAt: new Date(),
          deliveryIssueSettledBy: actorId,
          deliveryIssueSettlementNote: note,
        },
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DELIVERY_ISSUE_SETTLED',
        load.shortageOrDamage,
        null,
        { note },
      );
      return await this.stageService.closeIfReady(tenantId, actorId, settled);
    } catch (error) {
      rethrow(error, 'Failed to settle delivery issue');
    }
  }

  /** Driver-app "Report An Issue" — a load's own driver flags a problem (breakdown, halt,
   *  accident, etc.) while carrying it. `driverOwnerId` is set only by driver-portal's
   *  self-service call — see updateStatus's doc comment above for the ownership-check/audit-FK
   *  reasoning; identical here.
   *
   *  Unlike updateStatus/uploadPod there is no staff-initiated equivalent of this action to
   *  disambiguate from, so `userId` stays null unconditionally and one audit action name
   *  (LOAD_ISSUE_REPORTED) covers it — no `_BY_DRIVER` variant needed. */
  async reportIssue(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ReportLoadIssueInput,
    driverOwnerId?: string,
  ): Promise<LoadIssueReportEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (COMPLETED_LOAD_STATUSES.includes(load.status)) {
        throw new ConflictError('Cannot report an issue on a load that is already closed');
      }

      for (const key of input.photoFileKeys ?? []) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, key, 'loads/issue');
      }

      const issue = await this.loadIssueRepository.create({
        tenantId,
        loadId,
        reportedBy: actorId,
        ...input,
      });

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'ISSUE_REPORTED',
        null,
        input.category,
        { category: input.category, photoCount: input.photoFileKeys?.length ?? 0 },
      );
      await this.auditService.log({
        tenantId,
        userId: null,
        action: 'LOAD_ISSUE_REPORTED',
        resourceType: 'load',
        newData: { id: issue.id, loadId, category: input.category, driverId: actorId },
      });
      if (input.category === 'breakdown') {
        await this.onBreakdownReported?.({ tenantId, loadId, issueId: issue.id });
      }

      return issue;
    } catch (error) {
      rethrow(error, 'Failed to report load issue');
    }
  }

  /** A trip with an unresolved accident/breakdown can't move forward until staff resolve it. */
  private async assertNotHalted(tenantId: string, loadId: string): Promise<void> {
    const open = buildIncident(
      await this.loadIssueRepository.findLatestOpenByLoad(tenantId, loadId),
    );
    if (open?.halted) {
      throw new ConflictError('This trip is on hold because of a reported incident');
    }
  }

  /** Staff marks a driver-reported issue resolved — releases the hold if it was an accident or
   *  breakdown. Idempotent-safe: resolving an already-resolved report is a 404, not a re-stamp. */
  async resolveIssue(
    tenantId: string,
    actorId: string,
    loadId: string,
    issueId: string,
  ): Promise<LoadIssueReportEntity> {
    try {
      await this.assertExists(tenantId, loadId);
      const issue = await this.loadIssueRepository.resolve(tenantId, loadId, issueId, actorId);
      if (!issue) throw new NotFoundError(`Open issue ${issueId} not found on load ${loadId}`);

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_ISSUE_RESOLVED',
        resourceType: 'load',
        newData: { id: issue.id, loadId, category: issue.category },
      });
      return issue;
    } catch (error) {
      rethrow(error, 'Failed to resolve load issue');
    }
  }

  async listIssues(tenantId: string, loadId: string): Promise<LoadIssueReportEntity[]> {
    try {
      return await this.loadIssueRepository.listByLoad(tenantId, loadId);
    } catch (error) {
      rethrow(error, 'Failed to list load issues');
    }
  }

  /** Wide-relation counterpart to assertExists, for the read-only Detail path only — see
   *  load.repository.ts's findDetailById doc comment for why this isn't just assertExists. */
  private async assertDetailExists(tenantId: string, id: string): Promise<LoadEntity> {
    try {
      const load = await this.repository.findDetailById(tenantId, id);
      if (!load) throw new NotFoundError(`Load ${id} not found`);
      return load;
    } catch (error) {
      rethrow(error, 'Failed to verify load exists');
    }
  }

  /** Load Detail / Trip Detail — status, documents (resolved to download URLs), payments, the
   *  full chronological activity timeline (with actor names), the route's stage stepper, and
   *  the next-action panel (next stage, tracking/advance-due info). This is the single trip
   *  detail screen — see loads.openapi.ts.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — see updateStatus's doc
   *  comment above for the ownership-check reasoning; identical here (masked as not-found, no
   *  audit/activity write happens on a read so there's no FK concern to branch on). */
  async get(
    tenantId: string,
    actorRole: string,
    loadId: string,
    driverOwnerId?: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<LoadDetailView> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const [timeline, payments, loadWithUrls, contactPhones, openIssue] = await Promise.all([
        this.loadActivityService.listByLoad(tenantId, loadId),
        this.loadPaymentRepository.listByLoad(tenantId, loadId),
        this.withDocumentDownloadUrls(tenantId, actorRole, load),
        this.authService.getOrganizationContactPhones(tenantId),
        this.loadIssueRepository.findLatestOpenByLoad(tenantId, loadId),
      ]);
      const incident = buildIncident(openIssue);

      return {
        load: loadWithUrls,
        ownerPhoneNumber: contactPhones.ownerPhoneNumber,
        dispatchPhoneNumber: contactPhones.dispatchPhoneNumber,
        documentKeys: {
          invoiceFileKey: load.invoiceFileKey,
          ewayBillFileKey: load.ewayBillFileKey,
          elrFileKey: load.elrFileKey,
          podFileKey: load.podFileKey,
          podBackFileKey: load.podBackFileKey,
          weighingSlipFileKey: load.weighingSlipFileKey,
          loadingPhotoFileKeys: load.loadingPhotoFileKeys,
        },
        timeline,
        payments,
        ewayBillExpiry: this.getEwayBillExpiry(load),
        stepper: buildStepper(load, locale, incident),
        nextAction: buildNextAction(load, locale),
        incident,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch load');
    }
  }

  /** The tenant a driver's load lives in, for the driver portal's per-load routes — the driver can
   *  be linked to several tenants, so it is derived from the load. Not-found when the load isn't
   *  this driver's in any of their tenants (same masking as the ownership checks below). */
  async resolveDriverLoadTenant(
    driverId: string,
    tenantIds: string[],
    loadId: string,
  ): Promise<string> {
    try {
      const tenantId = await this.repository.findTenantIdForDriverLoad(loadId, driverId, tenantIds);
      if (!tenantId) throw new NotFoundError(`Load ${loadId} not found`);
      return tenantId;
    } catch (error) {
      rethrow(error, 'Failed to resolve load');
    }
  }

  /** Driver-app "Trip Done" detail screen — a lean, single-pickup/single-drop summary for a
   *  completed trip, distinct from get() above (whose payments/stepper/nextAction are staff
   *  planning-oriented and meaningless once a trip is closed). See TripDoneDetail's doc comment
   *  for the single-drop scope. Ownership check identical to get()'s driverOwnerId branch. */
  async getMyTripDetail(
    tenantId: string,
    driverId: string,
    loadId: string,
  ): Promise<TripDoneDetail> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (load.driverId !== driverId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      return toTripDoneDetail(load);
    } catch (error) {
      rethrow(error, 'Failed to fetch trip detail');
    }
  }

  /** Driver-app "Show papers" screen — the load's E-way bill / LR / Invoice with signed download
   *  URLs, plus the vehicle and route header. Ownership check identical to getMyTripDetail's;
   *  any load status is allowed, since the papers matter most while the trip is in transit. */
  async getLoadDocuments(tenantId: string, driverId: string, loadId: string): Promise<LoadPapers> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (load.driverId !== driverId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const resolveNullable = (key: string | null) =>
        key ? this.resolveDownloadUrl(tenantId, 'driver', key) : Promise.resolve(null);
      const [eway_bill, lr, invoice] = await Promise.all([
        resolveNullable(load.ewayBillFileKey),
        resolveNullable(load.elrFileKey),
        resolveNullable(load.invoiceFileKey),
      ]);
      return toLoadPapers(load, { eway_bill, lr, invoice }, this.getEwayBillExpiry(load));
    } catch (error) {
      rethrow(error, 'Failed to fetch load documents');
    }
  }

  /** Trips Home-page list — one row per load with its route/customer/vehicle-source resolved,
   *  plus tenant-wide Active/Completed tab counts (independent of which group, if any, was
   *  requested) so the UI can render both tab badges from a single call. */
  async list(
    tenantId: string | string[],
    input: ListLoadsInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<ListTripsResult> {
    try {
      const { requisitionId, sourceType, transporterId, vehicleId, driverId, search } = input;
      const [[items, total], counts] = await Promise.all([
        this.repository.list(tenantId, input),
        this.repository.countByGroup(tenantId, {
          requisitionId,
          sourceType,
          transporterId,
          vehicleId,
          driverId,
          search,
        }),
      ]);
      return {
        ...paginate(
          items.map((load) => toTripListRow(load, locale)),
          total,
          input,
        ),
        counts,
      };
    } catch (error) {
      rethrow(error, 'Failed to list loads');
    }
  }

  /** Driver-app "Trips Done" screen — see TripsDoneResult's doc comment for scope/omissions. */
  async getMyTripsDone(
    tenantId: string | string[],
    driverId: string,
    input: PaginationInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<TripsDoneResult> {
    try {
      const [[items, total], stats] = await Promise.all([
        this.repository.list(tenantId, { ...input, driverId, group: 'completed' }),
        this.repository.getCompletedStatsForDriver(tenantId, driverId),
      ]);
      const epodVerifiedPercentage =
        stats.totalCompleted === 0
          ? 0
          : Math.round((stats.podVerifiedCount / stats.totalCompleted) * 100);
      return {
        ...paginate(
          items.map((load) => toTripListRow(load, locale)),
          total,
          input,
        ),
        totalTrips: stats.totalCompleted,
        epodVerifiedPercentage,
      };
    } catch (error) {
      rethrow(error, 'Failed to list completed trips');
    }
  }
}
