import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { toDateString } from '../../shared/utils/date';
import { AuditService } from '../audit/audit.service';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleServiceUsageEntity } from './entities/vehicle-service-usage.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import { VehicleOperationalStatusEntity } from './entities/vehicle-operational-status.entity';
import { VehicleTelemetryMetaEntity } from './entities/vehicle-telemetry-meta.entity';
import { VehicleVerificationSnapshotEntity } from './entities/vehicle-verification-snapshot.entity';
import {
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VehicleDocumentStatus,
  VehicleDocumentType,
} from './utils/vehicle.type';
import { VehicleRepository } from './vehicle.repository';
import { TruckTypeService } from './truck-type.service';
import { FleetDriverLinkService } from './fleet-driver-link.service';
import { UlipClient, UlipVehicleResult } from '../../adapters/ulip.client';
import { DOCUMENT_EXPIRING_SOON_DAYS } from './masters.constants';
import { Paginated, paginate } from './utils/masters.types';
import {
  AddVehicleDocumentInput,
  CreateVehicleInput,
  ListComplianceAlertsInput,
  ListVehiclesInput,
  OnboardVehicleInput,
  RecordVehicleVerificationInput,
  SetVehicleOperationalStatusInput,
  SetVehicleServiceUsageInput,
  SetVehicleTelemetryMetaInput,
  UpdateVehicleDocumentInput,
  UpdateVehicleInput,
  VehicleVerificationPapersInput,
} from './utils/vehicle.interface';

/** Derives the document's lifecycle state from its expiry date; undated documents stay `valid`. */
export function resolveDocumentStatus(expiryDate: string | null): VehicleDocumentStatus {
  if (!expiryDate) return 'valid';

  const expiry = new Date(`${expiryDate}T00:00:00.000Z`);
  const now = new Date();
  const daysRemaining = Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= DOCUMENT_EXPIRING_SOON_DAYS) return 'expiring_soon';
  return 'valid';
}

export class VehicleService {
  constructor(
    private readonly vehicleRepository: VehicleRepository,
    private readonly truckTypeService: TruckTypeService,
    private readonly fleetDriverLinkService: FleetDriverLinkService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly ulipClient: UlipClient,
  ) {}

  /**
   * Preflight check used by the "Verify registration" step of the Add-a-vehicle form, before the
   * vehicle record exists — mirrors DriverService.checkDrivingLicence. Not persisted; the caller
   * bundles the result into recordVerification (standalone, or as part of onboardVehicle).
   */
  async checkVehicleRegistration(registrationNumber: string): Promise<UlipVehicleResult> {
    try {
      return await this.ulipClient.verifyVehicle(registrationNumber);
    } catch (error) {
      rethrow(error, 'Failed to check vehicle registration against VAHAN');
    }
  }

  /**
   * Only called internally, by onboardVehicle — there is no standalone create-vehicle route.
   * org_admin's own vehicle lands `active` immediately; dispatch's (the only other role
   * masters.routes.ts's canWrite gate admits) lands `pending` until an org_admin reviews it via
   * approveVehicle/rejectVehicle.
   */
  private async createVehicle(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: CreateVehicleInput,
    manager?: EntityManager,
  ): Promise<VehicleEntity> {
    try {
      const registrationNumber = input.registrationNumber.toUpperCase();

      const existing = await this.vehicleRepository.findByRegistrationNumber(
        tenantId,
        registrationNumber,
      );
      if (existing) {
        throw new ConflictError(
          `A vehicle with registration number ${registrationNumber} already exists`,
        );
      }

      if (input.truckTypeId) {
        await this.truckTypeService.assertTruckTypeExists(tenantId, input.truckTypeId);
      }

      const autoApproved = actorRole === ORG_ADMIN_ROLE;

      return await this.vehicleRepository.create(
        {
          tenantId,
          registrationNumber,
          truckTypeId: input.truckTypeId ?? null,
          fuelType: input.fuelType ?? null,
          bodyType: input.bodyType ?? null,
          wheelCount: input.wheelCount ?? null,
          capacityTons: input.capacityTons === undefined ? null : String(input.capacityTons),
          ownershipType: input.ownershipType ?? 'owned',
          status: autoApproved ? 'active' : 'pending',
          approvedBy: autoApproved ? actorId : null,
          approvedAt: autoApproved ? new Date() : null,
          createdBy: actorId,
        },
        manager,
      );
    } catch (error) {
      rethrow(error, 'Failed to create vehicle');
    }
  }

  async listVehicles(
    tenantId: string,
    input: ListVehiclesInput,
  ): Promise<Paginated<VehicleEntity>> {
    try {
      const { items, total } = await this.vehicleRepository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list vehicles');
    }
  }

  async listComplianceAlerts(
    tenantId: string,
    input: ListComplianceAlertsInput,
  ): Promise<Paginated<VehicleDocumentEntity>> {
    try {
      // +1: resolveDocumentStatus compares expiry's midnight-UTC instant against the real current
      // instant, so its floor() drops a day off the count except at exactly 00:00:00 UTC — a
      // document expiring in DOCUMENT_EXPIRING_SOON_DAYS + 1 calendar days still resolves to
      // 'expiring_soon'. This keeps the SQL cutoff aligned with that boundary.
      const expiryBefore = toDateString(
        new Date(Date.now() + (DOCUMENT_EXPIRING_SOON_DAYS + 1) * 24 * 60 * 60 * 1000),
      );

      const { items, total } = await this.vehicleRepository.listComplianceAlerts(tenantId, {
        ...input,
        expiryBefore,
      });

      // Recompute live rather than trust the persisted `status` column, which is only refreshed
      // on document create/update and can go stale — see resolveDocumentStatus's doc comment.
      const alerts = items.map((document) => ({
        ...document,
        status: resolveDocumentStatus(document.expiryDate),
      }));

      return paginate(alerts, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list compliance alerts');
    }
  }

  async getVehicle(tenantId: string, vehicleId: string): Promise<VehicleEntity> {
    try {
      const vehicle = await this.vehicleRepository.findByIdWithRelations(tenantId, vehicleId);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle');
    }
  }

  async updateVehicle(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<VehicleEntity> {
    try {
      const { driverId, ...fields } = input;

      if (fields.truckTypeId) {
        await this.truckTypeService.assertTruckTypeExists(tenantId, fields.truckTypeId);
      }

      return await this.dataSource.transaction(async (manager) => {
        await this.assertVehicleExists(tenantId, vehicleId, manager);

        if (Object.keys(fields).length > 0) {
          await this.vehicleRepository.update(
            tenantId,
            vehicleId,
            {
              ...fields,
              capacityTons:
                fields.capacityTons === undefined ? undefined : String(fields.capacityTons),
              updatedBy: actorId,
            },
            manager,
          );
        }

        // Selecting a driver on the edit-vehicle form re-links them as primary, in the same
        // transaction as the field changes above — see FleetDriverLinkService.setPrimaryDriver.
        if (driverId) {
          await this.fleetDriverLinkService.setPrimaryDriver(
            tenantId,
            actorId,
            vehicleId,
            driverId,
            manager,
          );
        }

        const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId, manager);
        if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
        return vehicle;
      });
    } catch (error) {
      rethrow(error, 'Failed to update vehicle');
    }
  }

  async deleteVehicle(tenantId: string, actorId: string, vehicleId: string): Promise<void> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);
      await this.vehicleRepository.softDelete(tenantId, vehicleId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete vehicle');
    }
  }

  async addDocument(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: AddVehicleDocumentInput,
  ): Promise<VehicleDocumentEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const expiryDate = input.expiryDate ?? null;
      return await this.vehicleRepository.createDocument({
        tenantId,
        vehicleId,
        documentType: input.documentType,
        documentNumber: input.documentNumber ?? null,
        issueDate: input.issueDate ?? null,
        expiryDate,
        fileUrl: input.fileUrl ?? null,
        status: resolveDocumentStatus(expiryDate),
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add vehicle document');
    }
  }

  async listDocuments(tenantId: string, vehicleId: string): Promise<VehicleDocumentEntity[]> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);
      return await this.vehicleRepository.listDocuments(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to list vehicle documents');
    }
  }

  async updateDocument(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    documentId: string,
    input: UpdateVehicleDocumentInput,
  ): Promise<VehicleDocumentEntity> {
    try {
      const existing = await this.vehicleRepository.findDocumentById(
        tenantId,
        vehicleId,
        documentId,
      );
      if (!existing) throw new NotFoundError(`Vehicle document ${documentId} not found`);

      // documentType isn't resubmitted on PATCH, so this is the one place left that can still
      // reject a fileUrl on the 5 dated paper types — the create-time validator can't see it here.
      if (
        input.fileUrl &&
        (VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY as readonly string[]).includes(existing.documentType)
      ) {
        throw new ValidationError('fileUrl is not accepted for this document type');
      }

      // Recompute the status whenever the caller moves the expiry date.
      const expiryDate = input.expiryDate === undefined ? existing.expiryDate : input.expiryDate;

      const document = await this.vehicleRepository.updateDocument(
        tenantId,
        vehicleId,
        documentId,
        {
          ...input,
          expiryDate,
          status: resolveDocumentStatus(expiryDate),
          updatedBy: actorId,
        },
      );
      if (!document) throw new NotFoundError(`Vehicle document ${documentId} not found`);
      return document;
    } catch (error) {
      rethrow(error, 'Failed to update vehicle document');
    }
  }

  async deleteDocument(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    documentId: string,
  ): Promise<void> {
    try {
      const existing = await this.vehicleRepository.findDocumentById(
        tenantId,
        vehicleId,
        documentId,
      );
      if (!existing) throw new NotFoundError(`Vehicle document ${documentId} not found`);
      await this.vehicleRepository.softDeleteDocument(tenantId, vehicleId, documentId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete vehicle document');
    }
  }

  async getOperationalStatus(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleOperationalStatusEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const status = await this.vehicleRepository.findOperationalStatus(tenantId, vehicleId);
      if (!status) throw new NotFoundError(`Vehicle ${vehicleId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle operational status');
    }
  }

  /** One row per vehicle, so the first call inserts and later calls overwrite it. */
  async setOperationalStatus(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: SetVehicleOperationalStatusInput,
    manager?: EntityManager,
  ): Promise<VehicleOperationalStatusEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId, manager);

      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const existing = await this.vehicleRepository.findOperationalStatus(tenantId, vehicleId);

      if (!existing) {
        return await this.vehicleRepository.createOperationalStatus(
          {
            tenantId,
            vehicleId,
            operationalStatus: input.operationalStatus,
            reason: input.reason ?? null,
            effectiveAt,
            createdBy: actorId,
          },
          manager,
        );
      }

      const status = await this.vehicleRepository.updateOperationalStatus(tenantId, vehicleId, {
        operationalStatus: input.operationalStatus,
        reason: input.reason ?? null,
        effectiveAt,
        updatedBy: actorId,
      });
      if (!status) throw new NotFoundError(`Vehicle ${vehicleId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to set vehicle operational status');
    }
  }

  async getTelemetryMeta(tenantId: string, vehicleId: string): Promise<VehicleTelemetryMetaEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const meta = await this.vehicleRepository.findTelemetryMeta(tenantId, vehicleId);
      if (!meta) throw new NotFoundError(`Vehicle ${vehicleId} has no telemetry metadata yet`);
      return meta;
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle telemetry metadata');
    }
  }

  /** One row per vehicle, so the first call inserts and later calls patch the stored row. */
  async setTelemetryMeta(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: SetVehicleTelemetryMetaInput,
    manager?: EntityManager,
  ): Promise<VehicleTelemetryMetaEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId, manager);

      const emiAmount = input.emiAmount === undefined ? undefined : String(input.emiAmount);
      const existing = await this.vehicleRepository.findTelemetryMeta(tenantId, vehicleId);

      if (!existing) {
        return await this.vehicleRepository.createTelemetryMeta(
          {
            tenantId,
            vehicleId,
            gpsProvider: input.gpsProvider ?? null,
            gpsEnabled: input.gpsEnabled ?? false,
            emiAmount: emiAmount ?? null,
            emiEndDate: input.emiEndDate ?? null,
            createdBy: actorId,
          },
          manager,
        );
      }

      const meta = await this.vehicleRepository.updateTelemetryMeta(tenantId, vehicleId, {
        ...input,
        emiAmount,
        updatedBy: actorId,
      });
      if (!meta) throw new NotFoundError(`Vehicle ${vehicleId} has no telemetry metadata yet`);
      return meta;
    } catch (error) {
      rethrow(error, 'Failed to set vehicle telemetry metadata');
    }
  }

  async getServiceUsage(tenantId: string, vehicleId: string): Promise<VehicleServiceUsageEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const usage = await this.vehicleRepository.findServiceUsage(tenantId, vehicleId);
      if (!usage) throw new NotFoundError(`Vehicle ${vehicleId} has no service usage recorded yet`);
      return usage;
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle service usage');
    }
  }

  /** One row per vehicle, so the first call inserts and later calls patch the stored row. */
  async setServiceUsage(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: SetVehicleServiceUsageInput,
    manager?: EntityManager,
  ): Promise<VehicleServiceUsageEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId, manager);

      const existing = await this.vehicleRepository.findServiceUsage(tenantId, vehicleId);

      if (!existing) {
        return await this.vehicleRepository.createServiceUsage(
          {
            tenantId,
            vehicleId,
            odometerKm: input.odometerKm ?? null,
            lastServiceDate: input.lastServiceDate ?? null,
            lastServiceOdometerKm: input.lastServiceOdometerKm ?? null,
            lastTyreChangeBrand: input.lastTyreChangeBrand ?? null,
            lastTyreChangeDate: input.lastTyreChangeDate ?? null,
            createdBy: actorId,
          },
          manager,
        );
      }

      const usage = await this.vehicleRepository.updateServiceUsage(tenantId, vehicleId, {
        ...input,
        updatedBy: actorId,
      });
      if (!usage) throw new NotFoundError(`Vehicle ${vehicleId} has no service usage recorded yet`);
      return usage;
    } catch (error) {
      rethrow(error, 'Failed to set vehicle service usage');
    }
  }

  async recordVerification(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: RecordVehicleVerificationInput,
    outerManager?: EntityManager,
  ): Promise<VehicleVerificationSnapshotEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId, outerManager);

      const run = async (manager: EntityManager) => {
        const verified = input.verificationStatus === 'verified';

        const snapshot = await this.vehicleRepository.createVerificationSnapshot(
          {
            tenantId,
            vehicleId,
            verificationType: input.verificationType,
            verificationStatus: input.verificationStatus,
            sourceReference: input.sourceReference ?? null,
            registeredName: input.registeredName ?? null,
            registeredOn: input.registeredOn ?? null,
            vehicleClass: input.vehicleClass ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            pinCode: input.pinCode ?? null,
            responsePayload: input.responsePayload ?? null,
            verifiedAt: verified ? new Date() : null,
            checkedAt: new Date(),
            createdBy: actorId,
          },
          manager,
        );

        // A confirmed registry response is the source of truth for the papers, so fold its
        // expiry dates into the document rows the compliance column reads from.
        if (verified && input.papers) {
          await this.applyVerifiedPapers(tenantId, actorId, vehicleId, input.papers, manager);
        }

        return snapshot;
      };

      return outerManager ? await run(outerManager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to record vehicle verification');
    }
  }

  async listVerifications(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleVerificationSnapshotEntity[]> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);
      return await this.vehicleRepository.listVerificationSnapshots(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to list vehicle verifications');
    }
  }

  /** Upserts one document per registry-supplied expiry date, leaving any attached file alone. */
  private async applyVerifiedPapers(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    papers: VehicleVerificationPapersInput,
    manager: EntityManager,
  ): Promise<void> {
    const byType: [VehicleDocumentType, string | undefined][] = [
      ['insurance', papers.insuranceValidTo],
      ['rc', papers.rcValidTo],
      ['permit', papers.permitValidTo],
      ['puc', papers.pucValidTo],
      ['fitness', papers.fitnessValidTo],
    ];

    for (const [documentType, expiryDate] of byType) {
      if (!expiryDate) continue;

      const existing = await this.vehicleRepository.findDocumentByType(
        tenantId,
        vehicleId,
        documentType,
        manager,
      );
      const status = resolveDocumentStatus(expiryDate);

      if (existing) {
        await this.vehicleRepository.updateDocument(
          tenantId,
          vehicleId,
          existing.id,
          { expiryDate, status, updatedBy: actorId },
          manager,
        );
        continue;
      }

      await this.vehicleRepository.createDocument(
        {
          tenantId,
          vehicleId,
          documentType,
          documentNumber: null,
          issueDate: null,
          expiryDate,
          fileUrl: null,
          status,
          createdBy: actorId,
        },
        manager,
      );
    }
  }

  /**
   * Backs the single "Save vehicle" button: creates the vehicle and every section of the form in
   * one transaction, so a failure partway through rolls the whole thing back rather than leaving a
   * half-built vehicle behind. Returns the vehicle with its relations loaded.
   */
  async onboardVehicle(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: OnboardVehicleInput,
  ): Promise<VehicleEntity> {
    try {
      const {
        verification,
        telemetry,
        serviceUsage,
        documents,
        operationalStatus,
        driverLink,
        ...vehicleInput
      } = input;

      const vehicleId = await this.dataSource.transaction(async (manager) => {
        const vehicle = await this.createVehicle(
          tenantId,
          actorId,
          actorRole,
          vehicleInput,
          manager,
        );

        if (verification) {
          await this.recordVerification(tenantId, actorId, vehicle.id, verification, manager);
        }

        // Explicit documents come after the registry write-back so an attached file wins over a bare date.
        for (const document of documents ?? []) {
          const expiryDate = document.expiryDate ?? null;
          const existing = await this.vehicleRepository.findDocumentByType(
            tenantId,
            vehicle.id,
            document.documentType,
            manager,
          );

          if (existing) {
            await this.vehicleRepository.updateDocument(
              tenantId,
              vehicle.id,
              existing.id,
              {
                ...document,
                expiryDate,
                status: resolveDocumentStatus(expiryDate),
                updatedBy: actorId,
              },
              manager,
            );
            continue;
          }

          await this.vehicleRepository.createDocument(
            {
              tenantId,
              vehicleId: vehicle.id,
              documentType: document.documentType,
              documentNumber: document.documentNumber ?? null,
              issueDate: document.issueDate ?? null,
              expiryDate,
              fileUrl: document.fileUrl ?? null,
              status: resolveDocumentStatus(expiryDate),
              createdBy: actorId,
            },
            manager,
          );
        }

        if (telemetry) {
          await this.setTelemetryMeta(tenantId, actorId, vehicle.id, telemetry, manager);
        }

        if (serviceUsage) {
          await this.setServiceUsage(tenantId, actorId, vehicle.id, serviceUsage, manager);
        }

        await this.setOperationalStatus(
          tenantId,
          actorId,
          vehicle.id,
          {
            operationalStatus: operationalStatus?.operationalStatus ?? 'idle',
            reason: operationalStatus?.reason,
            effectiveAt: operationalStatus?.effectiveAt,
          },
          manager,
        );

        // Same transaction as the vehicle itself, so a driver picked at onboarding time (e.g. not
        // active, or already linked elsewhere) rolls the whole vehicle creation back too.
        if (driverLink) {
          await this.fleetDriverLinkService.linkDriver(
            tenantId,
            actorId,
            vehicle.id,
            driverLink,
            manager,
          );
        }

        return vehicle.id;
      });

      return await this.getVehicle(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to onboard vehicle');
    }
  }

  /**
   * Shared by this service and the fleet-link service, which needs the vehicle to exist before linking.
   * Callers inside a transaction must pass the manager, or the read runs on another connection and
   * cannot see a vehicle created moments earlier in the same uncommitted transaction.
   */
  async assertVehicleExists(
    tenantId: string,
    vehicleId: string,
    manager?: EntityManager,
  ): Promise<VehicleEntity> {
    try {
      const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId, manager);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to verify vehicle exists');
    }
  }

  /** Approves a vehicle dispatch added — see createVehicle's pending/active split. */
  async approveVehicle(
    tenantId: string,
    actorId: string,
    vehicleId: string,
  ): Promise<VehicleEntity> {
    try {
      const existing = await this.assertVehicleExists(tenantId, vehicleId);
      if (existing.status !== 'pending') {
        throw new ConflictError('Only a pending vehicle can be approved');
      }

      const vehicle = await this.vehicleRepository.approve(tenantId, vehicleId, actorId);
      if (!vehicle) throw new ConflictError('Vehicle approval failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'VEHICLE_APPROVED',
        resourceType: 'vehicle',
        oldData: { id: vehicleId, status: 'pending' },
        newData: { id: vehicleId, status: 'active', approvedBy: actorId },
      });

      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to approve vehicle');
    }
  }

  async rejectVehicle(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
  ): Promise<VehicleEntity> {
    try {
      const existing = await this.assertVehicleExists(tenantId, vehicleId);
      if (existing.status !== 'pending') {
        throw new ConflictError('Only a pending vehicle can be rejected');
      }

      const vehicle = await this.vehicleRepository.reject(tenantId, vehicleId, actorId, reason);
      if (!vehicle) throw new ConflictError('Vehicle rejection failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'VEHICLE_REJECTED',
        resourceType: 'vehicle',
        oldData: { id: vehicleId, status: 'pending' },
        newData: { id: vehicleId, status: 'rejected', rejectionReason: reason },
      });

      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to reject vehicle');
    }
  }
}
