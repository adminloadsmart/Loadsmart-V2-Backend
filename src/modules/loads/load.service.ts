import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { VehicleService, resolveDocumentStatus } from '../masters/vehicle.service';
import { DriverService } from '../masters/driver.service';
import { TransporterService } from '../masters/transporter.service';
import { StorageService } from '../storage/storage.service';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../masters/utils/vehicle.type';
import { paginate, Paginated } from '../masters/utils/masters.types';
import { LoadRepository } from './load.repository';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadEntity } from './entities/load.entity';
import { LoadActivityEntity } from './entities/load-activity.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { LOAD_STATUSES, MANUAL_TRACKING_STATUSES, ManualTrackingStatus } from './utils/loads.types';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  EwayBillExpiry,
  ListLoadsInput,
  UploadPodInput,
} from './utils/load.interface';

const EWAY_BILL_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2-hour expiry alert

export interface LoadDetailView {
  load: LoadEntity;
  timeline: LoadActivityEntity[];
  payments: LoadPaymentEntity[];
  ewayBillExpiry: EwayBillExpiry;
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
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
   * Completes a load's vehicle/driver (own-fleet) or transporter/freight terms (market) — the
   * vehicle (own-fleet) or transporter (market) itself was already captured at Dispatch Planning
   * this is the Load Assignment screen. Own-fleet vehicles with an expired
   * mandatory compliance document are still assignable, but surface a non-blocking
   * warning back to the caller.
   */
  async assign(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AssignLoadInput,
  ): Promise<{ load: LoadEntity; complianceWarning: string | null }> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.status !== 'created') {
        throw new ConflictError('Only a newly created load can be assigned');
      }

      let complianceWarning: string | null = null;
      let vehicleNumber: string;
      let driverNumber: string;
      let driverId: string | null = null;

      if (load.sourceType === 'own_fleet') {
        if (!load.vehicleId) {
          throw new ConflictError('Own-fleet load has no vehicle set from dispatch planning');
        }
        const vehicle = await this.vehicleService.getVehicle(tenantId, load.vehicleId);
        vehicleNumber = vehicle.registrationNumber;

        const documentTypesWithExpiry: readonly string[] = VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY;
        const expiredTypes = (vehicle.documents ?? [])
          .filter((document) => documentTypesWithExpiry.includes(document.documentType))
          .filter((document) => resolveDocumentStatus(document.expiryDate) === 'expired');
        if (expiredTypes.length > 0) {
          complianceWarning =
            'This vehicle has one or more expired compliance documents (e.g. insurance/PUC/fitness). ' +
            'You can still assign it, but please verify before dispatch.';
        }

        if (input.driverId) {
          const driver = await this.driverService.getDriver(tenantId, input.driverId);
          driverId = driver.id;
          driverNumber = driver.phoneNumber;
        } else {
          const primaryLink = (vehicle.driverLinks ?? []).find(
            (link) => link.isPrimary && link.status === 'active',
          );
          if (!primaryLink) {
            throw new ValidationError(
              'This vehicle has no linked driver — pass driverId explicitly',
            );
          }
          driverId = primaryLink.driverId;
          driverNumber = primaryLink.driver?.phoneNumber ?? input.driverNumber ?? '';
        }
      } else {
        if (!load.transporterId) {
          throw new ConflictError('Market load has no transporter set from dispatch planning');
        }
        await this.transporterService.getTransporter(tenantId, load.transporterId);

        if (!input.vehicleNumber?.trim()) throw new ValidationError('vehicleNumber is required');
        if (!input.driverNumber?.trim()) throw new ValidationError('driverNumber is required');
        if (!input.freightType) throw new ValidationError('freightType is required');
        if (input.freightValue === undefined) throw new ValidationError('freightValue is required');
        if (input.advancePercentage === undefined)
          throw new ValidationError('advancePercentage is required');
        if (input.balancePercentage === undefined)
          throw new ValidationError('balancePercentage is required');

        vehicleNumber = input.vehicleNumber.trim();
        driverNumber = input.driverNumber.trim();
      }

      const updated = await this.repository.update(tenantId, loadId, {
        status: 'assigned',
        vehicleNumber,
        driverNumber,
        driverId,
        freightType: load.sourceType === 'market' ? (input.freightType ?? null) : null,
        freightValue:
          load.sourceType === 'market' && input.freightValue !== undefined
            ? String(input.freightValue)
            : null,
        advancePercentage:
          load.sourceType === 'market' && input.advancePercentage !== undefined
            ? String(input.advancePercentage)
            : null,
        balancePercentage:
          load.sourceType === 'market' && input.balancePercentage !== undefined
            ? String(input.balancePercentage)
            : null,
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
        newData: { id: loadId, status: 'assigned', vehicleNumber, driverNumber },
      });

      return { load: updated, complianceWarning };
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

  /** Load Detail — status, documents (resolved to download URLs), payments, and the
   *  full chronological activity timeline. */
  async get(tenantId: string, actorRole: string, loadId: string): Promise<LoadDetailView> {
    try {
      const load = await this.assertExists(tenantId, loadId);
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
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch load');
    }
  }

  async list(tenantId: string, input: ListLoadsInput): Promise<Paginated<LoadEntity>> {
    try {
      const [items, total] = await this.repository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list loads');
    }
  }
}
