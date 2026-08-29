import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { TransporterService } from '../masters/transporter.service';
import { VehicleService } from '../masters/vehicle.service';
import { StorageService } from '../storage/storage.service';
import { paginate, Paginated } from '../masters/utils/masters.types';
import { LoadRepository, UpdateLoadData } from './load.repository';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { LOAD_STATUSES, MANUAL_TRACKING_STATUSES, ManualTrackingStatus } from './utils/loads.types';
import { LoadActivityWithActor } from './utils/load-activity.interface';
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
  toTripListRow,
  TripListRow,
  TripNextAction,
  TripStepperStep,
} from './utils/trip-view';

const EWAY_BILL_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2-hour expiry alert

export interface ListTripsResult extends Paginated<TripListRow> {
  /** Tab counts for the whole tenant (scoped by the same non-group filters as the list itself),
   *  independent of which `group` — if any — the caller requested. */
  counts: { active: number; completed: number };
}

export interface LoadDetailView {
  load: LoadEntity;
  timeline: LoadActivityWithActor[];
  payments: LoadPaymentEntity[];
  ewayBillExpiry: EwayBillExpiry;
  stepper: TripStepperStep[];
  nextAction: TripNextAction;
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly loadPaymentRepository: LoadPaymentRepository,
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
          `Vehicle ${vehicleNumber} is already on an active load elsewhere (load ${clash.id}, status ${clash.status})`,
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
   *  masters/driver.service.ts's assertDriverDlUpload. */
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
    const resolve = async (key: string | null) => {
      if (!key) return key;
      const { downloadUrl } = await this.storageService.getByKey(
        { tenantId, role: actorRole },
        key,
      );
      return downloadUrl ?? key;
    };
    return {
      ...load,
      invoiceFileKey: await resolve(load.invoiceFileKey),
      ewayBillFileKey: await resolve(load.ewayBillFileKey),
      elrFileKey: await resolve(load.elrFileKey),
      podFileKey: await resolve(load.podFileKey),
    };
  }

  /** Ops attaches invoice/e-way bill/E-LR and confirms loading — triggers tracking and,
   *  for market loads, enables advance payment. Documents may be submitted one at a time or all
   *  together (load.validators.ts's confirmLoading allows any non-empty subset); this only flips
   *  the load to loading_confirmed once all three end up present on the row. */
  async confirmLoading(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.status !== 'assigned') {
        throw new ConflictError('Only an assigned load can have loading confirmed');
      }

      // C-04 — LR numbers are statutory and can never repeat, checked across every load in the
      // tenant regardless of status. Blocking, no override. Only checked when this call is
      // actually setting/changing the number — otherwise a partial-submission caller resubmitting
      // its own already-stored elrNumber would self-clash against the row it's about to update.
      const nextElrNumber = input.elrNumber?.trim();
      if (nextElrNumber && nextElrNumber !== load.elrNumber) {
        const clash = await this.repository.findByElrNumber(tenantId, nextElrNumber);
        if (clash) {
          throw new ConflictError(
            `E-LR number "${nextElrNumber}" is already used on load ${clash.id}`,
          );
        }
      }

      // Verify only the documents submitted this call — previously-saved keys were already
      // verified (as confirmed uploads for the right purpose) when they were first submitted.
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

      const now = new Date();
      const fields: UpdateLoadData = { updatedBy: actorId };
      if (input.invoiceNumber !== undefined) fields.invoiceNumber = input.invoiceNumber.trim();
      if (input.invoiceFileKey !== undefined) fields.invoiceFileKey = input.invoiceFileKey;
      if (input.ewayBillNumber !== undefined) fields.ewayBillNumber = input.ewayBillNumber.trim();
      if (input.ewayBillFileKey !== undefined) {
        fields.ewayBillFileKey = input.ewayBillFileKey;
        // Stamped when the e-way bill is actually uploaded (this call), not whenever the last
        // document happens to land — getEwayBillExpiry's 2-hour clock runs from generation time.
        fields.ewayBillGeneratedAt = now;
      }
      if (input.elrNumber !== undefined) fields.elrNumber = nextElrNumber ?? null;
      if (input.elrFileKey !== undefined) fields.elrFileKey = input.elrFileKey;

      // Step 1 — persist whatever arrived this call as a plain partial update, then re-read.
      // Completeness below is decided from this fresh, post-write row rather than an in-memory
      // merge of the pre-write read above: that's what lets two concurrent calls, each landing
      // one of the last two missing documents, both correctly see the full set once both writes
      // commit — deciding from the pre-write view would let both conclude "still incomplete".
      let updated = await this.repository.update(tenantId, loadId, fields);
      if (!updated) throw new ConflictError('Confirming loading failed');

      const uploadedMetadata: Record<string, unknown> = {};
      if (input.invoiceNumber !== undefined) uploadedMetadata.invoiceNumber = input.invoiceNumber;
      if (input.ewayBillNumber !== undefined)
        uploadedMetadata.ewayBillNumber = input.ewayBillNumber;
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

      const isComplete =
        !!updated.invoiceNumber &&
        !!updated.invoiceFileKey &&
        !!updated.ewayBillNumber &&
        !!updated.ewayBillFileKey &&
        !!updated.elrFileKey; // elrNumber intentionally excluded — same asymmetry as before

      if (isComplete && updated.status === 'assigned') {
        // Step 2 — conditional flip. WHERE status IN ('assigned') is both the business guard and
        // the race guard: if two concurrent calls each complete the set at the same instant, only
        // one UPDATE matches, so only one call ever logs STATUS_CHANGED/the audit entry.
        const confirmed = await this.repository.updateStatus(
          tenantId,
          loadId,
          ['assigned'],
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
            'assigned',
            'loading_confirmed',
          );
          await this.auditService.log({
            tenantId,
            userId: actorId,
            action: 'LOAD_LOADING_CONFIRMED',
            resourceType: 'load',
            oldData: { id: loadId, status: 'assigned' },
            newData: { id: loadId, status: 'loading_confirmed' },
          });
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
   *  `WHERE status = <current>` update also guards a concurrent double-advance race. */
  async updateStatus(
    tenantId: string,
    actorId: string,
    loadId: string,
    toStatus: ManualTrackingStatus,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      const manualTrackingStatuses: readonly string[] = MANUAL_TRACKING_STATUSES;
      const currentIndex = LOAD_STATUSES.indexOf(load.status);
      const nextStatus = LOAD_STATUSES[currentIndex + 1];
      if (nextStatus !== toStatus || !manualTrackingStatuses.includes(toStatus)) {
        throw new ConflictError(
          `Cannot move load from ${load.status} to ${toStatus} — the only valid next status is ${nextStatus ?? 'none'}`,
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
        userId: actorId,
        action: 'LOAD_STATUS_UPDATED',
        resourceType: 'load',
        oldData: { id: loadId, status: load.status },
        newData: { id: loadId, status: toStatus },
      });

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update load status');
    }
  }

  /** The delivery receipt — photo, receiver name/mobile/designation, quantity received, and the
   *  seal check are all required together (only podRemarks is optional). Marks the load
   *  Delivered; own-fleet loads close immediately (no payment gate), market loads wait for the
   *  balance payment (see load-payment.service.ts's recordBalance).
   *
   *  A 'broken' sealStatus is never a hard block — there's no exceptions/escalations module in
   *  this build to route it to yet — it's just recorded, clearly flagged, on the load's activity
   *  and audit trail so it's visible to whoever looks. Revisit once that module exists. */
  async uploadPod(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: UploadPodInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      const validPriorStatuses = [
        'loading_confirmed',
        'at_plant',
        'in_transit',
        'reached_delivery_point',
      ];
      if (!validPriorStatuses.includes(load.status)) {
        throw new ConflictError('E-POD can only be recorded once loading is confirmed');
      }

      await this.assertLoadDocumentUpload(tenantId, actorRole, input.podFileKey, 'trips/pod');

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'delivered',
        deliveredAt: new Date(),
        podFileKey: input.podFileKey,
        podReceiverName: input.podReceiverName,
        podReceiverMobile: input.podReceiverMobile,
        podReceiverDesignation: input.podReceiverDesignation,
        podQuantityReceived: String(input.podQuantityReceived),
        sealStatus: input.sealStatus,
        podRemarks: input.podRemarks ?? null,
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
        userId: actorId,
        action: 'LOAD_POD_RECORDED',
        resourceType: 'load',
        oldData: { id: loadId, status: load.status },
        newData: { id: loadId, status: 'delivered', sealStatus: input.sealStatus },
      });

      // TODO: notify Accounts for balance payment once real notification/queue
      // infra exists — src/jobs/queue-registry.ts is currently a no-op placeholder.

      if (updated.sourceType === 'own_fleet') {
        return await this.closeLoad(tenantId, actorId, loadId);
      }

      return updated;
    } catch (error) {
      rethrow(error, 'Failed to upload E-POD');
    }
  }

  /** Internal — own-fleet loads close right after E-POD (no payment gate); market loads close
   *  from load-payment.service.ts's recordBalance once both advance and balance are paid. */
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
   *  detail screen — see loads.openapi.ts. */
  async get(tenantId: string, actorRole: string, loadId: string): Promise<LoadDetailView> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      const [timeline, payments, loadWithUrls] = await Promise.all([
        this.loadActivityService.listByLoad(tenantId, loadId),
        this.loadPaymentRepository.listByLoad(tenantId, loadId),
        this.withDocumentDownloadUrls(tenantId, actorRole, load),
      ]);

      return {
        load: loadWithUrls,
        timeline,
        payments,
        ewayBillExpiry: this.getEwayBillExpiry(load),
        stepper: buildStepper(load),
        nextAction: buildNextAction(load),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch load');
    }
  }

  /** Trips Home-page list — one row per load with its route/customer/vehicle-source resolved,
   *  plus tenant-wide Active/Completed tab counts (independent of which group, if any, was
   *  requested) so the UI can render both tab badges from a single call. */
  async list(tenantId: string, input: ListLoadsInput): Promise<ListTripsResult> {
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
      return { ...paginate(items.map(toTripListRow), total, input), counts };
    } catch (error) {
      rethrow(error, 'Failed to list loads');
    }
  }
}
