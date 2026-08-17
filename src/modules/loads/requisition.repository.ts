import { DataSource, EntityManager, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { RequisitionEntity } from './entities/requisition.entity';
import { CreateRequisitionData, ListRequisitionsFilters } from './utils/requisition.interface';
import { RequisitionStatus } from './utils/loads.types';

/** Fields the requisitions search box matches against, OR'd together. */
const SEARCH_FIELDS: (keyof RequisitionEntity)[] = ['customerPoNumber'];

export class RequisitionRepository {
  private readonly requisitions: Repository<RequisitionEntity>;

  constructor(dataSource: DataSource) {
    this.requisitions = dataSource.getRepository(RequisitionEntity);
  }

  async create(data: CreateRequisitionData, manager?: EntityManager): Promise<RequisitionEntity> {
    const repo = manager?.getRepository(RequisitionEntity) ?? this.requisitions;
    const requisition = repo.create(data);
    return repo.save(requisition);
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<RequisitionEntity | null> {
    const repo = manager?.getRepository(RequisitionEntity) ?? this.requisitions;
    return repo.findOneBy({ id, tenantId });
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
