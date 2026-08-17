import { DataSource, EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { LoadEntity } from './entities/load.entity';
import { ListLoadsInput } from './utils/load.interface';
import { LoadSourceType, LoadStatus } from './utils/loads.types';

export interface CreateLoadData {
  tenantId: string;
  requisitionId: string;
  sourceType: LoadSourceType;
  plannedCapacityTonnes: string;
  truckTypeId?: string | null;
  feetWheels?: string | null;
  vehicleId?: string | null;
  vehicleNumber?: string | null;
  transporterId?: string | null;
  createdBy: string | null;
}

/** Every LoadEntity column a service may patch after creation — relations, id/tenantId/
 *  requisitionId/createdBy/createdAt/updatedAt are fixed at creation and excluded. */
export type UpdateLoadData = Partial<
  Omit<
    LoadEntity,
    | 'id'
    | 'tenantId'
    | 'requisitionId'
    | 'requisition'
    | 'truckType'
    | 'vehicle'
    | 'driver'
    | 'transporter'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
  >
>;

export type ListLoadsFilters = ListLoadsInput;

export class LoadRepository {
  private readonly loads: Repository<LoadEntity>;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
  }

  findById(tenantId: string, id: string, manager?: EntityManager): Promise<LoadEntity | null> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    return repo.findOneBy({ id, tenantId });
  }

  findByRequisitionId(tenantId: string, requisitionId: string): Promise<LoadEntity[]> {
    return this.loads.find({ where: { tenantId, requisitionId }, order: { createdAt: 'ASC' } });
  }

  async list(tenantId: string, filters: ListLoadsFilters): Promise<[LoadEntity[], number]> {
    const { page, limit, requisitionId, status, sourceType, transporterId, vehicleId } = filters;

    const where: FindOptionsWhere<LoadEntity> = { tenantId };
    if (requisitionId) where.requisitionId = requisitionId;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (transporterId) where.transporterId = transporterId;
    if (vehicleId) where.vehicleId = vehicleId;

    return this.loads.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async createMany(rows: CreateLoadData[], manager: EntityManager): Promise<LoadEntity[]> {
    const repo = manager.getRepository(LoadEntity);
    const entities = repo.create(rows);
    return repo.save(entities);
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateLoadData,
    manager?: EntityManager,
  ): Promise<LoadEntity | null> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    await repo.update({ id, tenantId }, data);
    return this.findById(tenantId, id, manager);
  }

  /** Conditional `WHERE status IN (fromStatuses)` update — doubles as both the business-rule
   *  guard (can't confirm/assign/advance a load that isn't in the expected prior state) and a
   *  race guard against a concurrent duplicate call advancing the same load twice. Returns null
   *  if no row matched (caller turns that into a ConflictError). */
  async updateStatus(
    tenantId: string,
    id: string,
    fromStatuses: LoadStatus[],
    toStatus: LoadStatus,
    extra: UpdateLoadData,
    manager?: EntityManager,
  ): Promise<LoadEntity | null> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    const result = await repo
      .createQueryBuilder()
      .update(LoadEntity)
      .set({ ...extra, status: toStatus })
      .where('id = :id AND tenant_id = :tenantId AND status IN (:...fromStatuses)', {
        id,
        tenantId,
        fromStatuses,
      })
      .execute();
    return result.affected === 1 ? this.findById(tenantId, id, manager) : null;
  }
}
