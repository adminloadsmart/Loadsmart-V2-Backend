import { DataSource, EntityManager, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { LoadingPointEntity } from './entities/loading-point.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import {
  CreateLoadingPointData,
  ListLoadingPointCitiesInput,
  ListLoadingPointsFilters,
  UpdateLoadingPointData,
} from './loading-point.interface';

/** Columns the loading-points search box ("Name, city or PIN…") matches against, OR'd. */
const SEARCH_COLUMNS = [
  'title',
  'city',
  'state',
  'pin_code',
  'area_locality',
  'landmark',
  'contact_person_name',
  'contact_person_number',
  'contact_person_email',
];

/** A loading point plus its creator's name ("entered by Harjit · unverified"). */
export type LoadingPointWithCreator = LoadingPointEntity & {
  createdByUser?: Pick<UserEntity, 'id' | 'fullName'> | null;
};

export class LoadingPointRepository {
  private readonly loadingPoints: Repository<LoadingPointEntity>;

  constructor(dataSource: DataSource) {
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
  }

  /** Bulk-upload duplicate check: same title (case-insensitive) and PIN, not deleted. */
  findByTitleAndPin(tenantId: string, title: string, pinCode: string) {
    return this.loadingPoints
      .createQueryBuilder('point')
      .where('point.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(TRIM(point.title)) = LOWER(TRIM(:title))', { title })
      .andWhere('point.pin_code = :pinCode', { pinCode: pinCode.trim() })
      .andWhere('point.deleted_at IS NULL')
      .getOne();
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

  private filteredQuery(
    tenantId: string,
    filters: Omit<ListLoadingPointsFilters, 'page' | 'limit'>,
  ) {
    const { search, city, status } = filters;
    const query = this.loadingPoints
      .createQueryBuilder('lp')
      .leftJoinAndMapOne('lp.createdByUser', UserEntity, 'creator', 'creator.id = lp.created_by')
      .where('lp.tenant_id = :tenantId AND lp.deleted_at IS NULL', { tenantId });
    if (city) query.andWhere('lp.city = :city', { city });
    if (status) query.andWhere('lp.status = :status', { status });
    if (search)
      query.andWhere(
        `(${SEARCH_COLUMNS.map((column) => `lp.${column} ILIKE :search`).join(' OR ')})`,
        {
          search: `%${search}%`,
        },
      );
    return query.orderBy('lp.created_at', 'DESC');
  }

  async list(
    tenantId: string,
    filters: ListLoadingPointsFilters,
  ): Promise<[LoadingPointWithCreator[], number]> {
    return this.filteredQuery(tenantId, filters)
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();
  }

  listForExport(
    tenantId: string,
    filters: Omit<ListLoadingPointsFilters, 'page' | 'limit'>,
    max: number,
  ): Promise<LoadingPointWithCreator[]> {
    return this.filteredQuery(tenantId, filters).take(max).getMany();
  }

  findWithCreator(tenantId: string, id: string): Promise<LoadingPointWithCreator | null> {
    return this.filteredQuery(tenantId, {}).andWhere('lp.id = :id', { id }).getOne();
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
