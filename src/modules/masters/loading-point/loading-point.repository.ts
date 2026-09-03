import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { LoadingPointEntity } from './entities/loading-point.entity';
import {
  CreateLoadingPointData,
  ListLoadingPointCitiesInput,
  ListLoadingPointsFilters,
  UpdateLoadingPointData,
} from './loading-point.interface';

/** Fields the loading-points search box matches against, OR'd together. */
const SEARCH_FIELDS: (keyof LoadingPointEntity)[] = [
  'title',
  'city',
  'state',
  'pinCode',
  'areaLocality',
  'landmark',
  'contactPersonName',
  'contactPersonNumber',
  'contactPersonEmail',
];

export class LoadingPointRepository {
  private readonly loadingPoints: Repository<LoadingPointEntity>;

  constructor(dataSource: DataSource) {
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
  }

  async create(data: CreateLoadingPointData, manager?: EntityManager): Promise<LoadingPointEntity> {
    const repo = manager?.getRepository(LoadingPointEntity) ?? this.loadingPoints;
    const loadingPoint = repo.create({ ...data, deletedAt: null });
    return repo.save(loadingPoint);
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<LoadingPointEntity | null> {
    const repo = manager?.getRepository(LoadingPointEntity) ?? this.loadingPoints;
    return repo.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  async list(
    tenantId: string,
    filters: ListLoadingPointsFilters,
  ): Promise<[LoadingPointEntity[], number]> {
    const { page, limit, search, city, status } = filters;

    const base: FindOptionsWhere<LoadingPointEntity> = { tenantId, deletedAt: IsNull() };
    if (city) base.city = city;
    if (status) base.status = status;

    // One OR'd where-clause per searchable field — TypeORM ORs entries of a where array, same
    // way findAndCount interprets a where array everywhere else in this codebase.
    const where: FindOptionsWhere<LoadingPointEntity>[] | FindOptionsWhere<LoadingPointEntity> =
      search ? SEARCH_FIELDS.map((field) => ({ ...base, [field]: ILike(`%${search}%`) })) : base;

    return this.loadingPoints.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** Distinct cities with at least one loading point — feeds the city filter dropdown, which
   * otherwise has no way to know what values are worth offering. */
  async listCities(tenantId: string, filters: ListLoadingPointCitiesInput): Promise<string[]> {
    const where: FindOptionsWhere<LoadingPointEntity> = { tenantId, deletedAt: IsNull() };
    if (filters.status) where.status = filters.status;

    const rows = await this.loadingPoints.find({
      select: { city: true },
      where,
      order: { city: 'ASC' },
    });
    return [...new Set(rows.map((row) => row.city))];
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateLoadingPointData,
    manager?: EntityManager,
  ): Promise<LoadingPointEntity | null> {
    const repo = manager?.getRepository(LoadingPointEntity) ?? this.loadingPoints;
    await repo.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id, manager);
  }

  async approve(tenantId: string, id: string, actorId: string): Promise<LoadingPointEntity | null> {
    const result = await this.loadingPoints.update(
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
  ): Promise<LoadingPointEntity | null> {
    const result = await this.loadingPoints.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      {
        status: 'rejected',
        rejectionReason: reason,
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.loadingPoints.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }
}
