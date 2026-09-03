import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import { VehicleOperationalStatusEntity } from './entities/vehicle-operational-status.entity';
import { VehicleTelemetryMetaEntity } from './entities/vehicle-telemetry-meta.entity';
import { VehicleVerificationSnapshotEntity } from './entities/vehicle-verification-snapshot.entity';
import { VehicleServiceUsageEntity } from './entities/vehicle-service-usage.entity';
import { VehicleDocumentType } from './vehicle.type';
import {
  CreateVehicleData,
  CreateVehicleDocumentData,
  CreateVehicleOperationalStatusData,
  CreateVehicleServiceUsageData,
  CreateVehicleTelemetryMetaData,
  CreateVehicleVerificationSnapshotData,
  ListComplianceAlertsFilters,
  ListVehiclesFilters,
  UpdateVehicleData,
  UpdateVehicleDocumentData,
  UpdateVehicleOperationalStatusData,
  UpdateVehicleServiceUsageData,
  UpdateVehicleTelemetryMetaData,
} from './vehicle.interface';

export class VehicleRepository {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly documents: Repository<VehicleDocumentEntity>;
  private readonly operationalStatuses: Repository<VehicleOperationalStatusEntity>;
  private readonly telemetryMeta: Repository<VehicleTelemetryMetaEntity>;
  private readonly verificationSnapshots: Repository<VehicleVerificationSnapshotEntity>;
  private readonly serviceUsage: Repository<VehicleServiceUsageEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.documents = dataSource.getRepository(VehicleDocumentEntity);
    this.operationalStatuses = dataSource.getRepository(VehicleOperationalStatusEntity);
    this.telemetryMeta = dataSource.getRepository(VehicleTelemetryMetaEntity);
    this.verificationSnapshots = dataSource.getRepository(VehicleVerificationSnapshotEntity);
    this.serviceUsage = dataSource.getRepository(VehicleServiceUsageEntity);
  }

  async create(data: CreateVehicleData, manager?: EntityManager): Promise<VehicleEntity> {
    const vehicles = manager ? manager.getRepository(VehicleEntity) : this.vehicles;
    const vehicle = vehicles.create({ ...data, deletedAt: null });
    return vehicles.save(vehicle);
  }

  findById(tenantId: string, id: string, manager?: EntityManager): Promise<VehicleEntity | null> {
    if (manager) {
      return manager.getRepository(VehicleEntity).findOneBy({ id, tenantId, deletedAt: IsNull() });
    }
    return this.vehicles.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findByIdWithRelations(tenantId: string, id: string): Promise<VehicleEntity | null> {
    return this.vehicles.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: {
        documents: true,
        driverLinks: { driver: true },
        truckType: true,
        telemetryMeta: true,
        serviceUsage: true,
        operationalStatus: true,
      },
    });
  }

  findByRegistrationNumber(
    tenantId: string,
    registrationNumber: string,
  ): Promise<VehicleEntity | null> {
    return this.vehicles.findOneBy({ tenantId, registrationNumber, deletedAt: IsNull() });
  }

  async list(
    tenantId: string,
    filters: ListVehiclesFilters,
  ): Promise<{ items: VehicleEntity[]; total: number }> {
    const { status, operationalStatus, search, page, limit } = filters;

    const base: FindOptionsWhere<VehicleEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;
    // The fleet list filters on the satellite row ("In use" / "Idle"), not the lifecycle status.
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };

    const where: FindOptionsWhere<VehicleEntity> = search
      ? { ...base, registrationNumber: ILike(`%${search}%`) }
      : base;

    const [items, total] = await this.vehicles.findAndCount({
      where,
      // driverLinks carries the full assignment history per vehicle (small — see findActiveLink),
      // with the driver relation so the fleet table can show the linked driver's name, not just
      // their id. Callers pick out the active/primary link themselves, same shape as GET /vehicles/:id.
      // telemetryMeta carries EMI + GPS fields (section 4 of the vehicle form) for the same reason.
      relations: {
        operationalStatus: true,
        truckType: true,
        driverLinks: { driver: true },
        telemetryMeta: true,
        serviceUsage: true,
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateVehicleData,
    manager?: EntityManager,
  ): Promise<VehicleEntity | null> {
    const vehicles = manager ? manager.getRepository(VehicleEntity) : this.vehicles;
    await vehicles.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id, manager);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.vehicles.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  /** Only a `pending` vehicle (dispatch's own onboardVehicle call) can be approved. */
  async approve(tenantId: string, id: string, actorId: string): Promise<VehicleEntity | null> {
    const result = await this.vehicles.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      {
        status: 'active',
        approvedBy: actorId,
        approvedAt: new Date(),
        rejectionReason: null,
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async reject(
    tenantId: string,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<VehicleEntity | null> {
    const result = await this.vehicles.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async createDocument(
    data: CreateVehicleDocumentData,
    manager?: EntityManager,
  ): Promise<VehicleDocumentEntity> {
    const documents = manager ? manager.getRepository(VehicleDocumentEntity) : this.documents;
    const document = documents.create({ ...data, deletedAt: null });
    return documents.save(document);
  }

  findDocumentByType(
    tenantId: string,
    vehicleId: string,
    documentType: VehicleDocumentType,
    manager?: EntityManager,
  ): Promise<VehicleDocumentEntity | null> {
    const documents = manager ? manager.getRepository(VehicleDocumentEntity) : this.documents;
    return documents.findOneBy({ tenantId, vehicleId, documentType, deletedAt: IsNull() });
  }

  findDocumentById(
    tenantId: string,
    vehicleId: string,
    id: string,
  ): Promise<VehicleDocumentEntity | null> {
    return this.documents.findOneBy({ id, vehicleId, tenantId, deletedAt: IsNull() });
  }

  listDocuments(tenantId: string, vehicleId: string): Promise<VehicleDocumentEntity[]> {
    return this.documents.find({
      where: { tenantId, vehicleId, deletedAt: IsNull() },
      order: { expiryDate: 'ASC' },
    });
  }

  /**
   * Fleet-wide, across every vehicle in the tenant — unlike listDocuments, which is scoped to one
   * vehicle. Always excludes documents belonging to a soft-deleted vehicle (no cascade exists
   * between vehicles.deleted_at and vehicle_documents), not just when `search` is given.
   */
  async listComplianceAlerts(
    tenantId: string,
    filters: ListComplianceAlertsFilters,
  ): Promise<{ items: VehicleDocumentEntity[]; total: number }> {
    const { documentType, search, expiryBefore, page, limit } = filters;

    const vehicleWhere: FindOptionsWhere<VehicleEntity> = search
      ? { deletedAt: IsNull(), registrationNumber: ILike(`%${search}%`) }
      : { deletedAt: IsNull() };

    // NULL expiryDate (rc_front/rc_back, or any undated doc) is excluded here for free: Postgres
    // evaluates `NULL <= x` as unknown/false, so it never satisfies a WHERE clause.
    const where: FindOptionsWhere<VehicleDocumentEntity> = {
      tenantId,
      deletedAt: IsNull(),
      expiryDate: LessThanOrEqual(expiryBefore),
      vehicle: vehicleWhere,
    };
    if (documentType) where.documentType = documentType;

    const [items, total] = await this.documents.findAndCount({
      where,
      relations: { vehicle: true },
      order: { expiryDate: 'ASC' }, // most overdue / soonest-expiring first
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async updateDocument(
    tenantId: string,
    vehicleId: string,
    id: string,
    data: UpdateVehicleDocumentData,
    manager?: EntityManager,
  ): Promise<VehicleDocumentEntity | null> {
    const documents = manager ? manager.getRepository(VehicleDocumentEntity) : this.documents;
    await documents.update({ id, vehicleId, tenantId, deletedAt: IsNull() }, data);
    return documents.findOneBy({ id, vehicleId, tenantId, deletedAt: IsNull() });
  }

  async softDeleteDocument(
    tenantId: string,
    vehicleId: string,
    id: string,
    deletedBy: string | null,
  ): Promise<void> {
    await this.documents.update(
      { id, vehicleId, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  findOperationalStatus(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleOperationalStatusEntity | null> {
    return this.operationalStatuses.findOneBy({ tenantId, vehicleId, deletedAt: IsNull() });
  }

  async createOperationalStatus(
    data: CreateVehicleOperationalStatusData,
    manager?: EntityManager,
  ): Promise<VehicleOperationalStatusEntity> {
    const statuses = manager
      ? manager.getRepository(VehicleOperationalStatusEntity)
      : this.operationalStatuses;
    const status = statuses.create({ ...data, deletedAt: null });
    return statuses.save(status);
  }

  async updateOperationalStatus(
    tenantId: string,
    vehicleId: string,
    data: UpdateVehicleOperationalStatusData,
  ): Promise<VehicleOperationalStatusEntity | null> {
    await this.operationalStatuses.update({ tenantId, vehicleId, deletedAt: IsNull() }, data);
    return this.findOperationalStatus(tenantId, vehicleId);
  }

  findTelemetryMeta(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleTelemetryMetaEntity | null> {
    return this.telemetryMeta.findOneBy({ tenantId, vehicleId, deletedAt: IsNull() });
  }

  async createTelemetryMeta(
    data: CreateVehicleTelemetryMetaData,
    manager?: EntityManager,
  ): Promise<VehicleTelemetryMetaEntity> {
    const telemetry = manager
      ? manager.getRepository(VehicleTelemetryMetaEntity)
      : this.telemetryMeta;
    const meta = telemetry.create({ ...data, deletedAt: null });
    return telemetry.save(meta);
  }

  async updateTelemetryMeta(
    tenantId: string,
    vehicleId: string,
    data: UpdateVehicleTelemetryMetaData,
  ): Promise<VehicleTelemetryMetaEntity | null> {
    await this.telemetryMeta.update({ tenantId, vehicleId, deletedAt: IsNull() }, data);
    return this.findTelemetryMeta(tenantId, vehicleId);
  }

  async createVerificationSnapshot(
    data: CreateVehicleVerificationSnapshotData,
    manager?: EntityManager,
  ): Promise<VehicleVerificationSnapshotEntity> {
    const snapshots = manager
      ? manager.getRepository(VehicleVerificationSnapshotEntity)
      : this.verificationSnapshots;
    const snapshot = snapshots.create({ ...data, deletedAt: null });
    return snapshots.save(snapshot);
  }

  listVerificationSnapshots(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleVerificationSnapshotEntity[]> {
    return this.verificationSnapshots.find({
      where: { tenantId, vehicleId, deletedAt: IsNull() },
      order: { checkedAt: 'DESC' },
    });
  }

  findServiceUsage(tenantId: string, vehicleId: string): Promise<VehicleServiceUsageEntity | null> {
    return this.serviceUsage.findOneBy({ tenantId, vehicleId, deletedAt: IsNull() });
  }

  async createServiceUsage(
    data: CreateVehicleServiceUsageData,
    manager?: EntityManager,
  ): Promise<VehicleServiceUsageEntity> {
    const usage = manager ? manager.getRepository(VehicleServiceUsageEntity) : this.serviceUsage;
    const row = usage.create({ ...data, deletedAt: null });
    return usage.save(row);
  }

  async updateServiceUsage(
    tenantId: string,
    vehicleId: string,
    data: UpdateVehicleServiceUsageData,
  ): Promise<VehicleServiceUsageEntity | null> {
    await this.serviceUsage.update({ tenantId, vehicleId, deletedAt: IsNull() }, data);
    return this.findServiceUsage(tenantId, vehicleId);
  }
}
