import { DataSource, EntityManager, FindOptionsWhere, ILike, Not, Repository } from 'typeorm';
import { RequisitionEntity } from './entities/requisition.entity';
import { RequisitionItemEntity } from './entities/requisition-item.entity';
import { CreateRequisitionData, ListRequisitionsFilters } from './utils/requisition.interface';
import { RequisitionItemUnit, RequisitionStatus } from './utils/loads.types';

export interface CreateRequisitionItemData {
  tenantId: string;
  requisitionId: string;
  productId: string;
  quantityTonnes: string;
  quantity: string | null;
  unit: RequisitionItemUnit | null;
}

/** Fields the requisitions search box matches against, OR'd together. */
const SEARCH_FIELDS: (keyof RequisitionEntity)[] = ['customerPoNumber'];

export class RequisitionRepository {
  private readonly requisitions: Repository<RequisitionEntity>;
  private readonly items: Repository<RequisitionItemEntity>;

  constructor(dataSource: DataSource) {
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.items = dataSource.getRepository(RequisitionItemEntity);
  }

  async create(data: CreateRequisitionData, manager?: EntityManager): Promise<RequisitionEntity> {
    const repo = manager?.getRepository(RequisitionEntity) ?? this.requisitions;
    const requisition = repo.create(data);
    return repo.save(requisition);
  }

  /** One product line per row (Plan Dispatch v2.0 R-02) — called once, right after `create`,
   *  inside the same transaction. */
  async createItems(
    rows: CreateRequisitionItemData[],
    manager: EntityManager,
  ): Promise<RequisitionItemEntity[]> {
    const repo = manager.getRepository(RequisitionItemEntity);
    return repo.save(repo.create(rows));
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<RequisitionEntity | null> {
    const repo = manager?.getRepository(RequisitionEntity) ?? this.requisitions;
    return repo.findOne({ where: { id, tenantId }, relations: { items: { product: true } } });
  }

  /** C-05 — the customer's PO/SO number checked against every other requisition in the tenant
   *  (case-sensitive exact match, matching how it's typed on the Order screen). */
  findByPoNumber(
    tenantId: string,
    customerPoNumber: string,
    excludeId?: string,
  ): Promise<RequisitionEntity | null> {
    return this.requisitions.findOneBy({
      tenantId,
      customerPoNumber,
      ...(excludeId ? { id: Not(excludeId) } : {}),
    });
  }

  async list(
    tenantId: string,
    filters: ListRequisitionsFilters,
  ): Promise<[RequisitionEntity[], number]> {
    const { page, limit, search, status, customerId } = filters;

    const base: FindOptionsWhere<RequisitionEntity> = { tenantId };
    if (status) base.status = status;
    if (customerId) base.customerId = customerId;

    const where: FindOptionsWhere<RequisitionEntity>[] | FindOptionsWhere<RequisitionEntity> =
      search ? SEARCH_FIELDS.map((field) => ({ ...base, [field]: ILike(`%${search}%`) })) : base;

    return this.requisitions.findAndCount({
      where,
      relations: { items: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** Atomic SQL increment — never read-then-write, so concurrent dispatch-planning calls against
   *  the same requisition can't lose an update racing each other. */
  async incrementDispatchedTonnes(
    tenantId: string,
    id: string,
    deltaTonnes: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(RequisitionEntity)
      .set({ dispatchedTonnes: () => 'dispatched_tonnes + :delta' })
      .where('id = :id AND tenant_id = :tenantId', { id, tenantId })
      .setParameter('delta', deltaTonnes)
      .execute();
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: RequisitionStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(RequisitionEntity) ?? this.requisitions;
    await repo.update({ id, tenantId }, { status });
  }

  async close(
    tenantId: string,
    id: string,
    data: { closedReason: string; closedBy: string },
  ): Promise<RequisitionEntity | null> {
    const result = await this.requisitions.update(
      { id, tenantId },
      {
        status: 'closed',
        closedReason: data.closedReason,
        closedBy: data.closedBy,
        closedAt: new Date(),
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }
}
