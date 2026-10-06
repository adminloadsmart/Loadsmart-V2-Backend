import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { humanizeStatus } from '../../shared/utils/humanize';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { VehicleService } from '../masters/vehicle/vehicle.service';
import { StorageService } from '../storage/storage.service';
import { paginate, Paginated, PaginationInput } from '../../shared/utils/pagination';
import { LoadRepository, UpdateLoadData } from './load.repository';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadIssueRepository } from './load-issue.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { LoadIssueReportEntity } from './entities/load-issue-report.entity';
import {
  COMPLETED_LOAD_STATUSES,
  LOAD_STATUSES,
  MANUAL_TRACKING_STATUSES,
  ManualTrackingStatus,
  PodReviewDecision,
} from './utils/loads.types';
import { LoadActivityWithActor } from './utils/load-activity.interface';
import { ReportLoadIssueInput } from './utils/load-issue.interface';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  EwayBillExpiry,
  ListLoadsInput,
  UploadPodInput,
} from './utils/load.interface';
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
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly authService: AuthService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly loadIssueRepository: LoadIssueRepository,
    private readonly transporterService: TransporterService,
    private readonly vehicleService: VehicleService,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
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
   * Load Assignment — market loads only. Own-fleet loads never reach this: vehicle+driver are
   * already known at Dispatch Planning (the same vehicle/driver-resolution + compliance-warning
   * logic this used to run lives in dispatch-planning.service.ts now), so they're created
   * directly in `assigned`. Market loads pick their transporter, vehicle number, driver number
   * and agreed freight here — none of that is known at planning time (Plan Dispatch v2.0 R-16).
   */
  async assign(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AssignLoadInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.sourceType !== 'market') {
        throw new ConflictError(
          'Own-fleet loads are assigned at Dispatch Planning, not through this endpoint',
        );
      }
      if (load.status !== 'created') {
        throw new ConflictError('Only a newly created load can be assigned');
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

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'assigned',
        transporterId: input.transporterId,
        vehicleNumber,
        driverNumber: input.driverNumber?.trim() ?? null,
        driverName: input.driverName?.trim() ?? null,
        freightType: input.freightType,
        freightValue,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Load assignment failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'STATUS_CHANGED',
        'created',
        'assigned',
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_ASSIGNED',
        resourceType: 'load',
        oldData: { id: loadId, status: 'created' },
        newData: {
          id: loadId,
          status: 'assigned',
          vehicleNumber: updated.vehicleNumber,
          driverNumber: updated.driverNumber,
          driverName: updated.driverName,
        },
      });

      return updated;
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
   * Attach/replace load documents (invoice/e-way bill/E-LR/loading photos/weighing slip) without
   * confirmLoading's status-transition semantics below — usable at any point in the load's
   * lifecycle except once closed (terminal), never checks completeness, never flips status.
   * confirmLoading remains the only path that transitions at_plant -> loading_confirmed. Useful
   * for correcting or adding a document after loading has already been confirmed (e.g. a wrong
   * invoice number, or a document that only arrived after the fact).
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

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update load documents');
    }
  }

  /** Ops or the assigned driver attaches invoice/e-way bill/E-LR (mandatory — but only whichever
   *  aren't already on the load, see isComplete below) plus optional loading photos/weighing slip,
   *  and confirms loading — triggers tracking and, for market loads, enables advance payment.
   *  Documents may be submitted one at a time or all together (load.validators.ts's
   *  confirmLoading allows any non-empty subset); this only flips the load to loading_confirmed
   *  once all three mandatory documents end up present on the row, whether accumulated across
   *  calls or already present from an earlier caller.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — same ownership-check-as-
   *  404 convention as uploadPod/reportIssue above. */
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
      if (load.status !== 'at_plant') {
        throw new ConflictError('Only a load at the plant can have loading confirmed');
      }

      const now = new Date();
      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);

      // Step 1 — persist whatever arrived this call as a plain partial update, then re-read.
      // Completeness below is decided from this fresh, post-write row rather than an in-memory
      // merge of the pre-write read above: that's what lets two concurrent calls, each landing
      // one of the last two missing documents, both correctly see the full set once both writes
      // commit — deciding from the pre-write view would let both conclude "still incomplete".
      let updated = await this.repository.update(tenantId, loadId, fields);
      if (!updated) throw new ConflictError('Confirming loading failed');

      await this.recordDocumentUpload(tenantId, loadId, actorId, input);

      const isComplete =
        !!updated.invoiceNumber &&
        !!updated.invoiceFileKey &&
        !!updated.ewayBillNumber &&
        !!updated.ewayBillFileKey &&
        !!updated.elrFileKey; // elrNumber intentionally excluded — same asymmetry as before

      if (isComplete && updated.status === 'at_plant') {
        // Step 2 — conditional flip. WHERE status IN ('at_plant') is both the business guard and
        // the race guard: if two concurrent calls each complete the set at the same instant, only
        // one UPDATE matches, so only one call ever logs STATUS_CHANGED/the audit entry.
        const confirmed = await this.repository.updateStatus(
          tenantId,
          loadId,
          ['at_plant'],
          'loading_confirmed',
          { loadingConfirmedAt: now, loadingConfirmedBy: actorId, updatedBy: actorId },
        );
        if (confirmed) {
          updated = confirmed;
          await this.loadActivityService.record(
            tenantId,
            loadId,
            actorId,
            'STATUS_CHANGED',
            'at_plant',
            'loading_confirmed',
          );
          await this.auditService.log({
            tenantId,
            // A driver caller's id isn't in users, so audit_logs.user_id's FK would reject it —
            // same convention as updateStatus: null the user and carry the driver in newData.
            userId: driverOwnerId ? null : actorId,
            action: 'LOAD_LOADING_CONFIRMED',
            resourceType: 'load',
            oldData: { id: loadId, status: 'at_plant' },
            newData: driverOwnerId
              ? { id: loadId, status: 'loading_confirmed', driverId: actorId }
              : { id: loadId, status: 'loading_confirmed' },
          });

          // Confirming loading means the truck is leaving the plant — advance straight to
          // in_transit, still passing through loading_confirmed above so the activity/audit trail
          // and stepper keep every stage. Guarded on loading_confirmed so it can't double-fire.
          const inTransit = await this.repository.updateStatus(
            tenantId,
            loadId,
            ['loading_confirmed'],
            'in_transit',
            { inTransitAt: new Date(), updatedBy: actorId },
          );
          if (inTransit) {
            updated = inTransit;
            await this.loadActivityService.record(
              tenantId,
              loadId,
              actorId,
              'STATUS_CHANGED',
              'loading_confirmed',
              'in_transit',
            );
            await this.auditService.log({
              tenantId,
              userId: driverOwnerId ? null : actorId,
              action: 'LOAD_STATUS_UPDATED',
              resourceType: 'load',
              oldData: { id: loadId, status: 'loading_confirmed' },
              newData: driverOwnerId
                ? { id: loadId, status: 'in_transit', driverId: actorId }
                : { id: loadId, status: 'in_transit' },
            });
          }
        } else {
          // Lost the race — a concurrent call already completed the transition and logged
          // STATUS_CHANGED/the audit entry. Reflect current state without duplicating those.
          updated = await this.assertExists(tenantId, loadId);
        }
      }

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to confirm loading');
    }
  }

  /** Computed on read — no scheduler/queue infra exists in this repo yet (src/jobs/queue-registry.ts
   *  is a no-op placeholder), so the 2-hour e-way-bill expiry is a derived flag, not a
   *  pushed notification. // TODO: wire a real alert once queue infra exists. */
  getEwayBillExpiry(load: LoadEntity): EwayBillExpiry {
    if (!load.ewayBillGeneratedAt) return { expiresAt: null, expired: false };
    const expiresAt = new Date(load.ewayBillGeneratedAt.getTime() + EWAY_BILL_VALIDITY_MS);
    const stillMoving = load.status !== 'delivered' && load.status !== 'closed';
    return { expiresAt: expiresAt.toISOString(), expired: stillMoving && new Date() > expiresAt };
  }

  /** Manual-only tracking advance. Rejects
   *  skipping ahead or moving backward through MANUAL_TRACKING_STATUSES; the conditional
   *  `WHERE status = <current>` update also guards a concurrent double-advance race.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — when present, the caller
   *  must be this load's own assigned driver (masked as not-found otherwise, same "no IDOR
   *  surface" convention driver-portal's getMyLoads already follows), and the audit entry is
   *  written without the driver's id in `userId` (audit_logs.user_id has a real FK to auth.users,
   *  which a masters.drivers id would violate) — see driver-portal.controller.ts. */
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
      const manualTrackingStatuses: readonly string[] = MANUAL_TRACKING_STATUSES;
      const currentIndex = LOAD_STATUSES.indexOf(load.status);
      const nextStatus = LOAD_STATUSES[currentIndex + 1];
      if (nextStatus !== toStatus || !manualTrackingStatuses.includes(toStatus)) {
        throw new ConflictError(
          `Cannot move load from ${humanizeStatus(load.status)} to ${humanizeStatus(toStatus)} — the only valid next status is ${humanizeStatus(nextStatus ?? 'none')}`,
        );
      }

      const timestampField =
        toStatus === 'at_plant'
          ? 'atPlantAt'
          : toStatus === 'in_transit'
            ? 'inTransitAt'
            : 'reachedDeliveryPointAt';

      const updated = await this.repository.updateStatus(
        tenantId,
        loadId,
        [load.status],
        toStatus,
        { [timestampField]: new Date(), updatedBy: actorId },
      );
      if (!updated) throw new ConflictError('Load status update failed — it may have just changed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'STATUS_CHANGED',
        load.status,
        toStatus,
      );
      await this.auditService.log({
        tenantId,
        userId: driverOwnerId ? null : actorId,
        action: driverOwnerId ? 'LOAD_STATUS_UPDATED_BY_DRIVER' : 'LOAD_STATUS_UPDATED',
        resourceType: 'load',
        oldData: { id: loadId, status: load.status },
        newData: driverOwnerId
          ? { id: loadId, status: toStatus, driverId: actorId }
          : { id: loadId, status: toStatus },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update load status');
    }
  }

  /** The delivery receipt — photo, receiver name/mobile, and quantity received are required;
   *  receiver designation and sealStatus are optional (kept for staff-side/older callers, but the
   *  driver-app ePOD screen doesn't collect either). Marks the load Delivered; own-fleet loads
   *  close immediately (no payment gate), market loads wait for the balance payment (see
   *  load-payment.service.ts's recordBalance).
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
      const validPriorStatuses = [
        'loading_confirmed',
        'at_plant',
        'in_transit',
        'reached_delivery_point',
      ];
      // A rejected E-POD can be resubmitted from 'delivered' — the truck already arrived, only
      // the paperwork is being redone, so this is the one case 'delivered' is itself a valid
      // prior status. See LoadEntity's podStatus doc comment.
      const isResubmission = load.status === 'delivered' && load.podStatus === 'rejected';
      if (!validPriorStatuses.includes(load.status) && !isResubmission) {
        throw new ConflictError('E-POD can only be recorded once loading is confirmed');
      }

      await this.assertLoadDocumentUpload(tenantId, actorRole, input.podFileKey, 'trips/pod');
      if (input.damagePhotoKey) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, input.damagePhotoKey, 'trips/pod');
      }

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'delivered',
        // Only stamp deliveredAt on the first upload — a resubmission after rejection doesn't
        // change when the truck physically arrived.
        ...(isResubmission ? {} : { deliveredAt: new Date() }),
        podFileKey: input.podFileKey,
        podReceiverName: input.podReceiverName,
        podReceiverMobile: input.podReceiverMobile,
        podReceiverDesignation: input.podReceiverDesignation ?? null,
        podQuantityReceived: String(input.podQuantityReceived),
        sealStatus: input.sealStatus ?? null,
        shortageOrDamage: input.shortageOrDamage ?? null,
        numberOfTonnesShort:
          input.numberOfTonnesShort === undefined ? null : String(input.numberOfTonnesShort),
        damagePhotoKey: input.damagePhotoKey ?? null,
        podRemarks: input.podRemarks ?? null,
        // Every upload (first or resubmission) restarts staff review from scratch.
        podStatus: 'pending',
        podRejectionReason: null,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Recording E-POD failed');

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
          shortageOrDamage: input.shortageOrDamage,
        },
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'STATUS_CHANGED',
        load.status,
        'delivered',
      );
      await this.auditService.log({
        tenantId,
        userId: driverOwnerId ? null : actorId,
        action: driverOwnerId ? 'LOAD_POD_RECORDED_BY_DRIVER' : 'LOAD_POD_RECORDED',
        resourceType: 'load',
        oldData: { id: loadId, status: load.status },
        newData: driverOwnerId
          ? {
              id: loadId,
              status: 'delivered',
              sealStatus: input.sealStatus,
              shortageOrDamage: input.shortageOrDamage,
              driverId: actorId,
            }
          : {
              id: loadId,
              status: 'delivered',
              sealStatus: input.sealStatus,
              shortageOrDamage: input.shortageOrDamage,
            },
      });

      // TODO: notify Accounts for balance payment once real notification/queue
      // infra exists — src/jobs/queue-registry.ts is currently a no-op placeholder.

      // No auto-close here — podStatus is 'pending' until staff reviews it via reviewPod below,
      // own-fleet included (own-fleet used to auto-close right here with no review at all; that
      // gap is what reviewPod exists to close).
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
   *  stuck). Rejecting leaves the load at 'delivered' — the driver resubmits via uploadPod above,
   *  which resets podStatus back to 'pending'. */
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
        if (updated.sourceType === 'own_fleet') {
          return await this.closeLoad(tenantId, actorId, loadId);
        }
        if (updated.advancePaidAt && updated.balancePaidAt) {
          return await this.closeLoad(tenantId, actorId, loadId);
        }
      }
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to review E-POD');
    }
  }

  /** Internal — own-fleet loads close as soon as their E-POD is accepted (no payment gate);
   *  market loads close once their E-POD is accepted AND both advance and balance are paid,
   *  whichever of reviewPod/load-payment.service.ts's recordBalance happens to complete last. */
  async closeLoad(tenantId: string, actorId: string, loadId: string): Promise<LoadEntity> {
    try {
      const updated = await this.repository.update(tenantId, loadId, {
        status: 'closed',
        closedAt: new Date(),
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Closing load failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'STATUS_CHANGED',
        'delivered',
        'closed',
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_CLOSED',
        resourceType: 'load',
        oldData: { id: loadId },
        newData: { id: loadId, status: 'closed' },
      });

      // Own-fleet loads carry a vehicleId (market loads don't) — release it back to idle now
      // that this was its one active load (dispatch-planning.service.ts's C-02 check guarantees
      // a vehicle never has more than one active load at a time).
      if (updated.vehicleId) {
        await this.vehicleService.setOperationalStatus(tenantId, actorId, updated.vehicleId, {
          operationalStatus: 'idle',
          reason: `Load ${loadId} closed`,
        });
      }

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to close load');
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

      return issue;
    } catch (error) {
      rethrow(error, 'Failed to report load issue');
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
   *  full chronological activity timeline (with actor names), the 8-step progress stepper, and
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
      const [timeline, payments, loadWithUrls, contactPhones] = await Promise.all([
        this.loadActivityService.listByLoad(tenantId, loadId),
        this.loadPaymentRepository.listByLoad(tenantId, loadId),
        this.withDocumentDownloadUrls(tenantId, actorRole, load),
        this.authService.getOrganizationContactPhones(tenantId),
      ]);

      return {
        load: loadWithUrls,
        ownerPhoneNumber: contactPhones.ownerPhoneNumber,
        dispatchPhoneNumber: contactPhones.dispatchPhoneNumber,
        documentKeys: {
          invoiceFileKey: load.invoiceFileKey,
          ewayBillFileKey: load.ewayBillFileKey,
          elrFileKey: load.elrFileKey,
          podFileKey: load.podFileKey,
          weighingSlipFileKey: load.weighingSlipFileKey,
          loadingPhotoFileKeys: load.loadingPhotoFileKeys,
        },
        timeline,
        payments,
        ewayBillExpiry: this.getEwayBillExpiry(load),
        stepper: buildStepper(load, locale),
        nextAction: buildNextAction(load, locale),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch load');
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
    tenantId: string,
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
    tenantId: string,
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
