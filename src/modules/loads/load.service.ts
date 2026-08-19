import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { TransporterService } from '../masters/transporter.service';
import { StorageService } from '../storage/storage.service';
import { paginate, Paginated } from '../masters/utils/masters.types';
import { LoadRepository } from './load.repository';
import { LoadPaymentRepository } from './load-payment.repository';
import { computeShareAmount } from './load-payment.service';
import { LoadActivityService } from './load-activity.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import {
  LOAD_STATUSES,
  LoadSourceType,
  LoadStatus,
  MANUAL_TRACKING_STATUSES,
  ManualTrackingStatus,
  TRIP_PROGRESS_STATUSES,
} from './utils/loads.types';
import { LoadActivityWithActor } from './utils/load-activity.interface';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  EwayBillExpiry,
  ListLoadsInput,
  UploadPodInput,
} from './utils/load.interface';

const EWAY_BILL_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2-hour expiry alert

/** One row of the Trips Home-page table — a flattened, display-ready projection of a Load plus
 *  its requisition's route/customer (neither of which the LoadEntity carries directly). */
export interface TripListRow {
  id: string;
  status: LoadStatus;
  requisitionId: string;
  route: {
    loadingPointTitle: string;
    loadingPointCity: string;
    deliveryPointLocation: string;
    deliveryPointCity: string | null;
  } | null;
  customer: { id: string; name: string } | null;
  vehicleNumber: string | null;
  source: { type: LoadSourceType; label: string };
  createdAt: string;
}

export interface ListTripsResult extends Paginated<TripListRow> {
  /** Tab counts for the whole tenant (scoped by the same non-group filters as the list itself),
   *  independent of which `group` — if any — the caller requested. */
  counts: { active: number; completed: number };
}

/** One entry of the trip-detail screen's 8-step progress stepper — walks LOAD_STATUSES in the
 *  true backend order (loading_confirmed before at_plant). */
export interface TripStepperStep {
  key: LoadStatus;
  label: string;
  completed: boolean;
  current: boolean;
  /** ISO timestamp from the matching *_At column; null for 'created'/'assigned', which have no
   *  dedicated timestamp column on LoadEntity. */
  at: string | null;
}

export interface TripNextAction {
  nextStatus: LoadStatus | null;
  /** 0 before 'assigned'; 1-6 while moving through TRIP_PROGRESS_STATUSES; capped at 6 once
   *  'closed'. */
  stepNumber: number;
  totalSteps: number;
  lastUpdate: { status: LoadStatus; at: string | null };
  advance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  balance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
}

export interface LoadDetailView {
  load: LoadEntity;
  timeline: LoadActivityWithActor[];
  payments: LoadPaymentEntity[];
  ewayBillExpiry: EwayBillExpiry;
  stepper: TripStepperStep[];
  nextAction: TripNextAction;
}

function humanizeStatus(status: LoadStatus): string {
  const words = status.split('_');
  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(' ')}`.trim();
}

function toTripListRow(load: LoadEntity): TripListRow {
  const req = load.requisition;
  return {
    id: load.id,
    status: load.status,
    requisitionId: load.requisitionId,
    route: req
      ? {
          loadingPointTitle: req.loadingPoint.title,
          loadingPointCity: req.loadingPoint.city,
          deliveryPointLocation: req.customerDeliveryPoint.location,
          deliveryPointCity: req.customerDeliveryPoint.city ?? null,
        }
      : null,
    customer: req ? { id: req.customer.id, name: req.customer.name } : null,
    vehicleNumber: load.vehicleNumber,
    source:
      load.sourceType === 'own_fleet'
        ? { type: 'own_fleet', label: 'Own fleet' }
        : {
            type: 'market',
            label: load.transporter ? `Market · ${load.transporter.name}` : 'Market',
          },
    createdAt: load.createdAt.toISOString(),
  };
}

/** Walks LOAD_STATUSES by index — the same indexing LoadService.updateStatus uses — to build
 *  the trip-detail screen's 8-step progress stepper. */
function buildStepper(load: LoadEntity): TripStepperStep[] {
  const currentIndex = LOAD_STATUSES.indexOf(load.status);
  const timestampByStatus: Partial<Record<LoadStatus, Date | null>> = {
    loading_confirmed: load.loadingConfirmedAt,
    at_plant: load.atPlantAt,
    in_transit: load.inTransitAt,
    reached_delivery_point: load.reachedDeliveryPointAt,
    delivered: load.deliveredAt,
    closed: load.closedAt,
  };
  return LOAD_STATUSES.map((status, index) => ({
    key: status,
    label: humanizeStatus(status),
    completed: index < currentIndex,
    current: index === currentIndex,
    at: timestampByStatus[status]?.toISOString() ?? null,
  }));
}

/** Next-action panel — what stage comes next, tracking/advance-due info. Advance/balance
 *  applicability and paid-state mirror the exact gating LoadPaymentService.recordAdvance/
 *  recordBalance already enforce (market-only, gated by loadingConfirmedAt/deliveredAt). */
function buildNextAction(load: LoadEntity): TripNextAction {
  const currentIndex = LOAD_STATUSES.indexOf(load.status);
  const nextStatus = LOAD_STATUSES[currentIndex + 1] ?? null;

  const progressIndex = TRIP_PROGRESS_STATUSES.indexOf(load.status);
  const stepNumber =
    load.status === 'closed'
      ? TRIP_PROGRESS_STATUSES.length
      : progressIndex === -1
        ? 0
        : progressIndex + 1;

  const isMarket = load.sourceType === 'market';
  const advanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.advancePercentage ?? '0') : null;
  const balanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.balancePercentage ?? '0') : null;

  return {
    nextStatus,
    stepNumber,
    totalSteps: TRIP_PROGRESS_STATUSES.length,
    lastUpdate: { status: load.status, at: load.updatedAt?.toISOString() ?? null },
    advance: {
      applicable: isMarket,
      amount: advanceAmount,
      paid: Boolean(load.advancePaidAt),
      paidAt: load.advancePaidAt?.toISOString() ?? null,
    },
    balance: {
      applicable: isMarket,
      amount: balanceAmount,
      paid: Boolean(load.balancePaidAt),
      paidAt: load.balancePaidAt?.toISOString() ?? null,
    },
  };
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly transporterService: TransporterService,
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
      if (!input.driverNumber?.trim()) throw new ValidationError('driverNumber is required');
      if (!input.freightType) throw new ValidationError('freightType is required');

      // The agreed rate — defaults to the target rate captured at planning if the caller doesn't
      // override it (e.g. the counter-offer negotiation landed on the original target).
      const freightValue =
        input.freightValue !== undefined ? String(input.freightValue) : load.expectedRate;

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'assigned',
        transporterId: input.transporterId,
        vehicleNumber: input.vehicleNumber.trim(),
        driverNumber: input.driverNumber.trim(),
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
   *  for market loads, enables advance payment. */
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
      // tenant regardless of status. Blocking, no override.
      if (input.elrNumber?.trim()) {
        const clash = await this.repository.findByElrNumber(tenantId, input.elrNumber.trim());
        if (clash) {
          throw new ConflictError(
            `E-LR number "${input.elrNumber.trim()}" is already used on load ${clash.id}`,
          );
        }
      }

      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.invoiceFileKey,
        'loads/invoice',
      );
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.ewayBillFileKey,
        'loads/eway-bill',
      );
      await this.assertLoadDocumentUpload(tenantId, actorRole, input.elrFileKey, 'trips/lr');

      const now = new Date();
      const updated = await this.repository.update(tenantId, loadId, {
        status: 'loading_confirmed',
        invoiceNumber: input.invoiceNumber.trim(),
        invoiceFileKey: input.invoiceFileKey,
        ewayBillNumber: input.ewayBillNumber.trim(),
        ewayBillFileKey: input.ewayBillFileKey,
        ewayBillGeneratedAt: now,
        elrNumber: input.elrNumber?.trim() ?? null,
        elrFileKey: input.elrFileKey,
        loadingConfirmedAt: now,
        loadingConfirmedBy: actorId,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Confirming loading failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_UPLOADED',
        null,
        null,
        { invoiceNumber: input.invoiceNumber, ewayBillNumber: input.ewayBillNumber },
      );
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

  /** Exactly one of {document upload} or {receiver name + quantity + remarks}. Marks
   *  the load Delivered; own-fleet loads close immediately (no payment gate), market loads wait
   *  for the balance payment (see load-payment.service.ts's recordBalance). */
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

      const hasDocument = Boolean(input.podFileKey);
      const hasForm = Boolean(input.podReceiverName && input.podQuantityReceived !== undefined);
      if (hasDocument === hasForm) {
        throw new ValidationError('Provide exactly one of a POD document or a filled POD form');
      }

      if (input.podFileKey) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, input.podFileKey, 'trips/pod');
      }

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'delivered',
        deliveredAt: new Date(),
        podFileKey: input.podFileKey ?? null,
        podReceiverName: input.podReceiverName ?? null,
        podQuantityReceived:
          input.podQuantityReceived === undefined ? null : String(input.podQuantityReceived),
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
        newData: { id: loadId, status: 'delivered' },
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
      const { requisitionId, sourceType, transporterId, vehicleId } = input;
      const [[items, total], counts] = await Promise.all([
        this.repository.list(tenantId, input),
        this.repository.countByGroup(tenantId, {
          requisitionId,
          sourceType,
          transporterId,
          vehicleId,
        }),
      ]);
      return { ...paginate(items.map(toTripListRow), total, input), counts };
    } catch (error) {
      rethrow(error, 'Failed to list loads');
    }
  }
}
