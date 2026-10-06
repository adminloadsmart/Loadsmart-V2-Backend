import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { toDateString } from '../../../shared/utils/date';
import { toIstDateString } from '../../../shared/utils/ist-time';
import { AuditService } from '../../audit/audit.service';
import { JobQueue } from '../../../jobs/queue-registry';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleServiceUsageEntity } from './entities/vehicle-service-usage.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import { VehicleOperationalStatusEntity } from './entities/vehicle-operational-status.entity';
import { VehicleTelemetryMetaEntity } from './entities/vehicle-telemetry-meta.entity';
import { VehicleVerificationSnapshotEntity } from './entities/vehicle-verification-snapshot.entity';
import {
  AXLE_TYPE_WHEEL_COUNTS,
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VehicleDocumentStatus,
  VehicleDocumentType,
} from './vehicle.type';
import { TyreSetupGateway } from './gateways/tyre-setup.gateway';
import { VehicleRepository } from './vehicle.repository';
import { buildVehicleWorkbook, VEHICLE_EXPORT_MAX_ROWS } from './vehicle-export.mapper';
import { TruckTypeService } from '../truck-type/truck-type.service';
import { FleetDriverLinkService } from '../fleet-driver-link/fleet-driver-link.service';
import { DOCUMENT_EXPIRING_SOON_DAYS, COMPLIANCE_ALERT_DAYS_BEFORE } from './vehicle.constants';
import { Paginated, paginate } from '../../../shared/utils/pagination';
import {
  AddVehicleDocumentInput,
  CreateVehicleInput,
  ExportVehiclesFilters,
  ListComplianceAlertsInput,
  ListVehiclesInput,
  OnboardVehicleCostInput,
  OnboardVehicleGpsInput,
  OnboardVehicleInput,
  RecordVehicleVerificationInput,
  SetVehicleOperationalStatusInput,
  SetVehicleServiceUsageInput,
  SetVehicleTelemetryMetaInput,
  TruckTypePickInput,
  UpdateVehicleDocumentInput,
  UpdateVehicleInput,
  VehicleTyreSummary,
  VehicleVerificationPapersInput,
  VehicleWithTyres,
} from './vehicle.interface';

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

/** Adds whole months to a YYYY-MM-DD date, clamping to the target month's last day. */
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateString(target);
}

/**
 * Folds the Add Truck drawer's "Truck cost" and "GPS" blocks (and the old form's `telemetry`
 * block, still accepted) into the one telemetry-meta row. "Months left" on the loan becomes an
 * EMI end date counted from today. Unless sent outright, the monthly fixed cost maintenance's
 * downtime figure reads is derived: lease rent for an attached truck, else EMI + premium / 12.
 */
function buildTelemetryInput(
  telemetry: SetVehicleTelemetryMetaInput | undefined,
  cost: OnboardVehicleCostInput | undefined,
  gps: OnboardVehicleGpsInput | undefined,
): SetVehicleTelemetryMetaInput | null {
  if (!telemetry && !cost && !gps) return null;

  const merged: SetVehicleTelemetryMetaInput = { ...telemetry };

  if (gps) {
    merged.hasGps = gps.hasGps;
    if (gps.provider !== undefined) merged.gpsProvider = gps.provider;
    if (gps.deviceImei !== undefined) merged.gpsDeviceImei = gps.deviceImei;
  }

  if (cost) {
    const { emiMonthsLeft, ...costFields } = cost;
    Object.assign(merged, costFields);
    if (emiMonthsLeft !== undefined) {
      merged.emiEndDate = addMonths(toIstDateString(new Date()), emiMonthsLeft);
    }

    if (merged.fixedCostMonthly === undefined) {
      if (cost.leaseRentMonthly !== undefined) {
        merged.fixedCostMonthly = cost.leaseRentMonthly;
      } else if (cost.emiAmount !== undefined || cost.insurancePremiumYearly !== undefined) {
        merged.fixedCostMonthly =
          Math.round(((cost.emiAmount ?? 0) + (cost.insurancePremiumYearly ?? 0) / 12) * 100) / 100;
      }
    }
  }

  return merged;
}

export class VehicleService {
  constructor(
    private readonly vehicleRepository: VehicleRepository,
    private readonly truckTypeService: TruckTypeService,
    private readonly fleetDriverLinkService: FleetDriverLinkService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly complianceAlertsQueue: JobQueue,
  ) {}

  /** Best-effort: schedules/reschedules the two one-time delayed jobs (15-day-before and expiry)
   *  behind the "vehicle compliance expiring/expired" notifications — see workers/vehicle-
   *  compliance-alerts.worker.ts. Called after any create/update that can change `expiryDate`
   *  (addDocument, updateDocument, applyVerifiedPapers, and onboardVehicle's own document loop).
   *  Cancels any previously-scheduled jobs for this document first, so re-saving reschedules
   *  cleanly instead of stacking duplicate notifications. */
  private async scheduleComplianceAlerts(document: VehicleDocumentEntity): Promise<void> {
    try {
      const expirySoonJobId = `expiry-soon:${document.id}`;
      const expiredJobId = `expired:${document.id}`;
      await this.complianceAlertsQueue.cancel(expirySoonJobId);
      await this.complianceAlertsQueue.cancel(expiredJobId);

      if (
        !document.expiryDate ||
        !(VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY as readonly string[]).includes(document.documentType)
      ) {
        return;
      }

      const expiryMs = new Date(`${document.expiryDate}T00:00:00.000Z`).getTime();
      const alertMs = expiryMs - COMPLIANCE_ALERT_DAYS_BEFORE * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const payload = {
        documentId: document.id,
        vehicleId: document.vehicleId,
        tenantId: document.tenantId,
      };

      if (expiryMs > now) {
        await this.complianceAlertsQueue.enqueue('expiry-soon', payload, {
          delay: Math.max(0, alertMs - now),
          jobId: expirySoonJobId,
        });
      }

      // Always scheduled, even if already expired — fires almost immediately (delay ≈ 0) rather
      // than being skipped, so a document imported/renewed already-expired still alerts.
      await this.complianceAlertsQueue.enqueue('expired', payload, {
        delay: Math.max(0, expiryMs - now),
        jobId: expiredJobId,
      });
    } catch (error) {
      console.error(`Failed to schedule compliance alerts for document ${document.id}`, error);
    }
  }

  private tyreSetupGateway: TyreSetupGateway | null = null;

  /** Maintenance is built after masters (it depends on this service), so its tyre gateway is
   *  handed in afterwards by composition-root.ts rather than through the constructor. */
  setTyreSetupGateway(gateway: TyreSetupGateway): void {
    this.tyreSetupGateway = gateway;
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
    input: CreateVehicleInput & { truckType?: TruckTypePickInput },
    manager?: EntityManager,
  ): Promise<VehicleEntity> {
    try {
      const registrationNumber = input.registrationNumber.toUpperCase();
      const { truckType: pick, ...fields } = input;

      const existing = await this.vehicleRepository.findByRegistrationNumber(
        tenantId,
        registrationNumber,
      );
      if (existing) {
        throw new ConflictError(
          `A vehicle with registration number ${registrationNumber} already exists`,
        );
      }

      // The drawer's picker resolves to a tenant truck type (created on first use) and also sets
      // the vehicle's own body/wheels/capacity/length, overriding any sent separately.
      if (pick) {
        const truckType = await this.truckTypeService.findOrCreateFromPicker(
          tenantId,
          actorId,
          {
            body: pick.body,
            wheel: pick.wheelCount ?? pick.axleType!,
            capacityTons: pick.capacityTons,
            bodyLengthFt: pick.bodyLengthFt,
          },
          manager,
        );
        fields.truckTypeId = truckType.id;
        fields.bodyType = pick.body;
        fields.wheelCount = pick.wheelCount ?? AXLE_TYPE_WHEEL_COUNTS[pick.axleType!];
        fields.axleType = pick.axleType;
        fields.capacityTons = pick.capacityTons;
        fields.bodyLengthFt = pick.bodyLengthFt;
      } else if (fields.truckTypeId) {
        await this.truckTypeService.assertTruckTypeExists(tenantId, fields.truckTypeId);
      }

      const autoApproved = actorRole === ORG_ADMIN_ROLE;

      return await this.vehicleRepository.create(
        {
          tenantId,
          registrationNumber,
          truckTypeId: fields.truckTypeId ?? null,
          fuelType: fields.fuelType ?? null,
          bodyType: fields.bodyType ?? null,
          makeModel: fields.makeModel ?? null,
          wheelCount: fields.wheelCount ?? null,
          capacityTons: fields.capacityTons === undefined ? null : String(fields.capacityTons),
          ownershipType: fields.ownershipType ?? 'owned',
          axleType: fields.axleType ?? null,
          bodyLengthFt: fields.bodyLengthFt ?? null,
          grossVehicleWeightKg: fields.grossVehicleWeightKg ?? null,
          unladenWeightKg: fields.unladenWeightKg ?? null,
          emissionNorm: fields.emissionNorm ?? null,
          vahanBodyType: fields.vahanBodyType ?? null,
          financierName: fields.financierName ?? null,
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

  /** Every vehicle matching the fleet-list filters as an .xlsx, in the vehicle import's column layout. */
  async exportVehicles(tenantId: string, filters: ExportVehiclesFilters): Promise<Buffer> {
    try {
      const vehicles = await this.vehicleRepository.listForExport(
        tenantId,
        filters,
        VEHICLE_EXPORT_MAX_ROWS,
      );
      return await buildVehicleWorkbook(vehicles);
    } catch (error) {
      rethrow(error, 'Failed to export vehicles');
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

  /** `listVehicles` plus each row's fitted tyres — the fleet list's response. Kept separate from
   *  listVehicles, which other modules (dispatch, dashboards) call and don't need tyres from. */
  async listVehiclesWithTyres(
    tenantId: string,
    input: ListVehiclesInput,
  ): Promise<Paginated<VehicleWithTyres>> {
    try {
      const page = await this.listVehicles(tenantId, input);
      const tyres = await this.fetchTyres(tenantId, page.items);
      return { ...page, items: page.items.map((v) => ({ ...v, tyres: tyres.get(v.id) ?? [] })) };
    } catch (error) {
      rethrow(error, 'Failed to list vehicles');
    }
  }

  /** `getVehicle` plus the vehicle's fitted tyres — the detail and onboarding response. */
  async getVehicleWithTyres(tenantId: string, vehicleId: string): Promise<VehicleWithTyres> {
    try {
      const vehicle = await this.getVehicle(tenantId, vehicleId);
      const tyres = await this.fetchTyres(tenantId, [vehicle]);
      return { ...vehicle, tyres: tyres.get(vehicle.id) ?? [] };
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle');
    }
  }

  // Not wired (e.g. a test container without maintenance) degrades to "no tyres" rather than failing a read.
  private async fetchTyres(
    tenantId: string,
    vehicles: VehicleEntity[],
  ): Promise<Map<string, VehicleTyreSummary[]>> {
    if (!this.tyreSetupGateway || vehicles.length === 0) return new Map();
    return this.tyreSetupGateway.listFittedForVehicles(
      tenantId,
      vehicles.map((v) => v.id),
    );
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
  ): Promise<VehicleWithTyres> {
    try {
      const { driverId, tyres, ...fields } = input;

      if (tyres && !this.tyreSetupGateway) {
        throw new Error('Tyre setup is not wired — see composition-root.ts');
      }

      if (fields.truckTypeId) {
        await this.truckTypeService.assertTruckTypeExists(tenantId, fields.truckTypeId);
      }

      const vehicle = await this.dataSource.transaction(async (manager) => {
        const existing = await this.assertVehicleExists(tenantId, vehicleId, manager);

        if (tyres && (fields.ownershipType ?? existing.ownershipType) === 'attached') {
          throw new ValidationError(
            'An attached truck has no tyre tracking — its owner handles tyres',
          );
        }

        // A truck in the workshop is released only by closing its breakdown, which puts it back
        // in front of dispatch in the same action — a manual status edit here would bypass that.
        if (
          fields.status !== undefined &&
          fields.status !== existing.status &&
          existing.status === 'under_maintenance'
        ) {
          throw new ConflictError(
            'Vehicle is in the workshop — close its breakdown in Maintenance to return it to service',
          );
        }

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

        const updated = await this.vehicleRepository.findById(tenantId, vehicleId, manager);
        if (!updated) throw new NotFoundError(`Vehicle ${vehicleId} not found`);

        // After the field changes, so a wheel-count / truck-type change in the same PATCH sets
        // the layout the tyres are checked against.
        if (tyres) {
          const usage = await this.vehicleRepository.findServiceUsage(tenantId, vehicleId, manager);
          await this.tyreSetupGateway!.updateTyreSet(
            tenantId,
            actorId,
            {
              id: vehicleId,
              wheelCount: updated.wheelCount,
              odometerKm: usage?.odometerKm ?? null,
            },
            tyres,
            manager,
          );
        }

        return updated;
      });

      const fittedTyres = await this.fetchTyres(tenantId, [vehicle]);
      return { ...vehicle, tyres: fittedTyres.get(vehicle.id) ?? [] };
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
      const document = await this.vehicleRepository.createDocument({
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
      await this.scheduleComplianceAlerts(document);
      return document;
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
      await this.scheduleComplianceAlerts(document);
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
      const existing = await this.vehicleRepository.findOperationalStatus(
        tenantId,
        vehicleId,
        manager,
      );

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

      const status = await this.vehicleRepository.updateOperationalStatus(
        tenantId,
        vehicleId,
        {
          operationalStatus: input.operationalStatus,
          reason: input.reason ?? null,
          effectiveAt,
          updatedBy: actorId,
        },
        manager,
      );
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

      const money = (value: number | undefined) =>
        value === undefined ? undefined : String(value);
      const emiAmount = money(input.emiAmount);
      const fixedCostMonthly = money(input.fixedCostMonthly);
      const insurancePremiumYearly = money(input.insurancePremiumYearly);
      const leaseRentMonthly = money(input.leaseRentMonthly);
      const existing = await this.vehicleRepository.findTelemetryMeta(tenantId, vehicleId, manager);

      if (!existing) {
        return await this.vehicleRepository.createTelemetryMeta(
          {
            tenantId,
            vehicleId,
            gpsProvider: input.gpsProvider ?? null,
            gpsEnabled: input.gpsEnabled ?? false,
            hasGps: input.hasGps ?? null,
            gpsDeviceImei: input.gpsDeviceImei ?? null,
            emiAmount: emiAmount ?? null,
            emiEndDate: input.emiEndDate ?? null,
            insurancePremiumYearly: insurancePremiumYearly ?? null,
            leaseRentMonthly: leaseRentMonthly ?? null,
            leaseEndDate: input.leaseEndDate ?? null,
            fuelPaidBy: input.fuelPaidBy ?? null,
            tollPaidBy: input.tollPaidBy ?? null,
            fixedCostMonthly: fixedCostMonthly ?? null,
            createdBy: actorId,
          },
          manager,
        );
      }

      const meta = await this.vehicleRepository.updateTelemetryMeta(
        tenantId,
        vehicleId,
        {
          ...input,
          emiAmount,
          fixedCostMonthly,
          insurancePremiumYearly,
          leaseRentMonthly,
          updatedBy: actorId,
        },
        manager,
      );
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

      const existing = await this.vehicleRepository.findServiceUsage(tenantId, vehicleId, manager);

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
            serviceIntervalKm: input.serviceIntervalKm ?? null,
            serviceIntervalMonths: input.serviceIntervalMonths ?? null,
            createdBy: actorId,
          },
          manager,
        );
      }

      const usage = await this.vehicleRepository.updateServiceUsage(
        tenantId,
        vehicleId,
        { ...input, updatedBy: actorId },
        manager,
      );
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
            registeringAuthority: input.registeringAuthority ?? null,
            financierName: input.financierName ?? null,
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
      ['road_tax', papers.roadTaxValidTo],
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
      const providerName = documentType === 'insurance' ? papers.insuranceProvider : undefined;

      if (existing) {
        const updated = await this.vehicleRepository.updateDocument(
          tenantId,
          vehicleId,
          existing.id,
          { expiryDate, ...(providerName && { providerName }), status, updatedBy: actorId },
          manager,
        );
        if (updated) await this.scheduleComplianceAlerts(updated);
        continue;
      }

      const created = await this.vehicleRepository.createDocument(
        {
          tenantId,
          vehicleId,
          documentType,
          documentNumber: null,
          providerName: providerName ?? null,
          issueDate: null,
          expiryDate,
          fileUrl: null,
          status,
          createdBy: actorId,
        },
        manager,
      );
      await this.scheduleComplianceAlerts(created);
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
  ): Promise<VehicleWithTyres> {
    try {
      const {
        verification,
        cost,
        gps,
        tyres,
        telemetry,
        serviceUsage,
        documents,
        operationalStatus,
        driverLink,
        ...vehicleInput
      } = input;

      if (tyres && !this.tyreSetupGateway) {
        throw new Error('Tyre setup is not wired — see composition-root.ts');
      }

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
            const updated = await this.vehicleRepository.updateDocument(
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
            if (updated) await this.scheduleComplianceAlerts(updated);
            continue;
          }

          const created = await this.vehicleRepository.createDocument(
            {
              tenantId,
              vehicleId: vehicle.id,
              documentType: document.documentType,
              documentNumber: document.documentNumber ?? null,
              providerName: document.providerName ?? null,
              issueDate: document.issueDate ?? null,
              expiryDate,
              fileUrl: document.fileUrl ?? null,
              status: resolveDocumentStatus(expiryDate),
              createdBy: actorId,
            },
            manager,
          );
          await this.scheduleComplianceAlerts(created);
        }

        const telemetryInput = buildTelemetryInput(telemetry, cost, gps);
        if (telemetryInput) {
          await this.setTelemetryMeta(tenantId, actorId, vehicle.id, telemetryInput, manager);
        }

        // Missing intervals are left null — maintenance falls back to its class defaults.
        if (serviceUsage) {
          await this.setServiceUsage(tenantId, actorId, vehicle.id, serviceUsage, manager);
        }

        if (tyres) {
          await this.tyreSetupGateway!.fitInitialSet(
            tenantId,
            actorId,
            {
              id: vehicle.id,
              wheelCount: vehicle.wheelCount,
              odometerKm: serviceUsage?.odometerKm ?? null,
            },
            tyres,
            manager,
          );
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

      return await this.getVehicleWithTyres(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to onboard vehicle');
    }
  }

  /**
   * Takes a truck out of dispatch while it is in the workshop: lifecycle status →
   * `under_maintenance` (which DispatchPlanningService's vehicle picker and buildOwnFleetLine
   * already refuse) and operational status → `inactive`. Called by the maintenance module inside
   * the same transaction that opens the breakdown, so the two can't disagree.
   */
  async placeMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    try {
      const vehicle = await this.assertVehicleExists(tenantId, vehicleId, manager);
      if (vehicle.status !== 'active') {
        throw new ConflictError(
          `Vehicle ${vehicle.registrationNumber} is ${vehicle.status} — only an active vehicle can be sent to the workshop`,
        );
      }

      await this.vehicleRepository.update(
        tenantId,
        vehicleId,
        { status: 'under_maintenance', updatedBy: actorId },
        manager,
      );
      await this.setOperationalStatus(
        tenantId,
        actorId,
        vehicleId,
        { operationalStatus: 'inactive', reason },
        manager,
      );
    } catch (error) {
      rethrow(error, 'Failed to place vehicle on maintenance hold');
    }
  }

  /** Inverse of placeMaintenanceHold — puts the truck back in front of dispatch. */
  async releaseMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId, manager);
      await this.vehicleRepository.update(
        tenantId,
        vehicleId,
        { status: 'active', updatedBy: actorId },
        manager,
      );
      await this.setOperationalStatus(
        tenantId,
        actorId,
        vehicleId,
        { operationalStatus: 'idle', reason },
        manager,
      );
    } catch (error) {
      rethrow(error, 'Failed to release vehicle from maintenance hold');
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
