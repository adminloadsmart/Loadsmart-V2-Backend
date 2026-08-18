import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { LoadEntity } from './entities/load.entity';
import { LoadCargoItemEntity } from './entities/load-cargo-item.entity';
import { ListLoadsInput } from './utils/load.interface';
import { FreightMode, LoadSourceType, LoadStatus } from './utils/loads.types';

/** Between Assignment and Delivered — a vehicle on a load in one of these statuses is "on a live
 *  trip elsewhere" (C-02). Deliberately excludes 'created' (own-fleet loads never sit there, per
 *  R-35) and 'delivered'/'closed' (no longer "live"). */
const ACTIVE_VEHICLE_STATUSES: LoadStatus[] = [
  'assigned',
  'loading_confirmed',
  'at_plant',
  'in_transit',
  'reached_delivery_point',
];

export interface CreateLoadData {
  tenantId: string;
  requisitionId: string;
  sourceType: LoadSourceType;
  status?: LoadStatus; // own-fleet lands 'assigned' directly (R-35); market defaults to 'created'
  plannedCapacityTonnes: string;
  truckTypeId?: string | null;
  feetWheels?: string | null;
  vehicleId?: string | null;
  vehicleNumber?: string | null;
  driverId?: string | null;
  driverNumber?: string | null;
  freightMode?: FreightMode | null;
  expectedRate?: string | null;
  advancePercentage?: string | null;
  balancePercentage?: string | null;
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
    | 'cargoItems'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
  >
>;

export type ListLoadsFilters = ListLoadsInput;

export interface ProductTonnage {
  productId: string;
  totalTonnes: string;
}

export class LoadRepository {
  private readonly loads: Repository<LoadEntity>;
  private readonly cargoItems: Repository<LoadCargoItemEntity>;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.cargoItems = dataSource.getRepository(LoadCargoItemEntity);
  }

  findById(tenantId: string, id: string, manager?: EntityManager): Promise<LoadEntity | null> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    return repo.findOne({ where: { id, tenantId }, relations: { cargoItems: { product: true } } });
  }

  findByRequisitionId(tenantId: string, requisitionId: string): Promise<LoadEntity[]> {
    return this.loads.find({
      where: { tenantId, requisitionId },
      relations: { cargoItems: true },
      order: { createdAt: 'ASC' },
    });
  }

  /** C-01 — same own-fleet vehicle already used by an existing load under this requisition
   *  (any status), across earlier dispatch-planning rounds. */
  findByRequisitionAndVehicles(
    tenantId: string,
    requisitionId: string,
    vehicleIds: string[],
    manager?: EntityManager,
  ): Promise<LoadEntity[]> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    return repo.find({ where: { tenantId, requisitionId, vehicleId: In(vehicleIds) } });
  }

  /** C-02 — the vehicle is on a live trip elsewhere in the tenant (any requisition). */
  findActiveByVehicles(
    tenantId: string,
    vehicleIds: string[],
    manager?: EntityManager,
  ): Promise<LoadEntity[]> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    return repo.find({
      where: { tenantId, vehicleId: In(vehicleIds), status: In(ACTIVE_VEHICLE_STATUSES) },
    });
  }

  /** C-03 — the vehicle appears on an earlier closed load in the tenant (amber, overridable). */
  findClosedByVehicles(
    tenantId: string,
    vehicleIds: string[],
    manager?: EntityManager,
  ): Promise<LoadEntity[]> {
    const repo = manager?.getRepository(LoadEntity) ?? this.loads;
    return repo.find({ where: { tenantId, vehicleId: In(vehicleIds), status: 'closed' } });
  }

  /** C-04 — the e-LR number is statutory and can never repeat, checked across every load in the
   *  tenant regardless of status. Called before the current load's own `elrNumber` is set, so no
   *  self-exclusion is needed. */
  findByElrNumber(tenantId: string, elrNumber: string): Promise<LoadEntity | null> {
    return this.loads.findOneBy({ tenantId, elrNumber });
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
      relations: { cargoItems: true },
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

  /** Same cargo mix written once per load spawned from a truck line (Plan Dispatch v2.0 R-08). */
  async createCargoItems(
    rows: { tenantId: string; loadId: string; productId: string; tonnesPerTruck: string }[],
    manager: EntityManager,
  ): Promise<LoadCargoItemEntity[]> {
    const repo = manager.getRepository(LoadCargoItemEntity);
    return repo.save(repo.create(rows));
  }

  /** Cumulative planned tonnage per product across every load ever created for this requisition
   *  — backs the "Allocation by product" panel (Plan Dispatch v2.0 §5.4). */
  async sumCargoByProductForRequisition(
    tenantId: string,
    requisitionId: string,
    manager?: EntityManager,
  ): Promise<ProductTonnage[]> {
    const repo = manager?.getRepository(LoadCargoItemEntity) ?? this.cargoItems;
    const rows = await repo
      .createQueryBuilder('cargoItem')
      .innerJoin('cargoItem.load', 'load')
      .select('cargoItem.productId', 'productId')
      .addSelect('SUM(cargoItem.tonnesPerTruck)', 'totalTonnes')
      .where('cargoItem.tenantId = :tenantId', { tenantId })
      .andWhere('load.requisitionId = :requisitionId', { requisitionId })
      .groupBy('cargoItem.productId')
      .getRawMany<{ productId: string; totalTonnes: string }>();
    return rows;
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
