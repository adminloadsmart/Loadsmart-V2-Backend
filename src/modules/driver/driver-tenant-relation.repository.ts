import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import {
  CreateDriverTenantRelationData,
  ListDriversFilters,
  UpdateDriverTenantRelationData,
} from './drivers.interface';

export class DriverTenantRelationRepository {
  private readonly relations: Repository<DriverTenantRelationEntity>;

  constructor(dataSource: DataSource) {
    this.relations = dataSource.getRepository(DriverTenantRelationEntity);
  }

  async create(
    data: CreateDriverTenantRelationData,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    const relation = relations.create({ ...data, rejectionReason: null, deletedAt: null });
    return relations.save(relation);
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  // Used only where the caller doesn't yet know the tenant — e.g. an already-authenticated driver
  // switching context to a relation by id (driver-auth.service.ts's selectRelation).
  findByIdForDriver(driverId: string, id: string): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOneBy({ id, driverId, deletedAt: IsNull() });
  }

  findByTenantAndDriver(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOneBy({ tenantId, driverId, deletedAt: IsNull() });
  }

  // Full staff-facing detail view: driver profile (with its person-level documents/verifications/
  // bank details) plus this tenant's operational status, trip metrics, and vehicle assignment.
  findByTenantAndDriverWithFullRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      relations: {
        driver: { documents: true, verifications: true, bankDetails: true },
        operationalStatus: true,
        tripMetrics: true,
        vehicleLinks: { vehicle: true },
      },
    });
  }

  // Driver-portal profile screen — same as above plus the assigned vehicle's own compliance
  // documents (insurance/fitness expiry) and truck type.
  findByTenantAndDriverWithProfileRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      relations: {
        driver: { documents: true, verifications: true, bankDetails: true },
        tripMetrics: true,
        vehicleLinks: { vehicle: { truckType: true, documents: true } },
      },
    });
  }

  async list(
    tenantId: string,
    filters: ListDriversFilters,
  ): Promise<{ items: DriverTenantRelationEntity[]; total: number }> {
    const { status, operationalStatus, search, page, limit } = filters;

    const base: FindOptionsWhere<DriverTenantRelationEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };

    // Search spans two columns on the driver profile, so it becomes two OR'd where-clauses.
    const where: FindOptionsWhere<DriverTenantRelationEntity>[] = search
      ? [
          { ...base, driver: { fullName: ILike(`%${search}%`) } },
          { ...base, driver: { phoneNumber: ILike(`%${search}%`) } },
        ]
      : [base];

    const [items, total] = await this.relations.findAndCount({
      where,
      relations: {
        driver: true,
        operationalStatus: true,
        tripMetrics: true,
        vehicleLinks: { vehicle: true },
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async softDelete(tenantId: string, driverId: string, deletedBy: string | null): Promise<void> {
    await this.relations.update(
      { tenantId, driverId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  /** Every relation a driver (identified globally) holds, across all tenants. */
  listByDriver(driverId: string): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  listActiveByDriver(driverId: string): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { driverId, status: 'active', deletedAt: IsNull() },
    });
  }

  listPendingStaffReview(tenantId: string): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateDriverTenantRelationData,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    await relations.update({ id, tenantId, deletedAt: IsNull() }, data);
    return relations.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  /** Only a `pending_staff_review` relation (dispatch onboarding or a driver join-request) can be approved. */
  async approve(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
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
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  /** Driver accepts a `pending_driver_review` relation (a fleet-owner-initiated invite). */
  async accept(id: string, driverId: string): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, driverId, status: 'pending_driver_review', deletedAt: IsNull() },
      { status: 'active', driverRespondedAt: new Date() },
    );
    if (result.affected !== 1) return null;
    return this.relations.findOneBy({ id, deletedAt: IsNull() });
  }

  async declineInvite(
    id: string,
    driverId: string,
    reason: string | null,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, driverId, status: 'pending_driver_review', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, driverRespondedAt: new Date() },
    );
    if (result.affected !== 1) return null;
    return this.relations.findOneBy({ id, deletedAt: IsNull() });
  }
}
