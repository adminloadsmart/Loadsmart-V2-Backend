import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ReferralCodeEntity } from './entities/referral-code.entity';
import { OrganizationEntity } from './entities/organization.entity';

export class ReferralCodeRepository {
  private readonly repo: Repository<ReferralCodeEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(ReferralCodeEntity);
  }

  async create(
    data: {
      code: string;
      ownerUserId: string | null;
      validUntil: string | null;
      createdBy: string | null;
    },
    manager?: EntityManager,
  ): Promise<ReferralCodeEntity> {
    const repo = manager ? manager.getRepository(ReferralCodeEntity) : this.repo;
    const referralCode = repo.create({ ...data, revokedAt: null });
    return repo.save(referralCode);
  }

  findByCode(code: string): Promise<ReferralCodeEntity | null> {
    return this.repo.findOneBy({ code });
  }

  findById(id: string): Promise<ReferralCodeEntity | null> {
    return this.repo.findOne({
      where: { id },
      relations: { owner: true },
      select: { owner: { id: true, fullName: true, email: true } },
    });
  }

  // Batched lookup for AuthService.listStaffUsers — one query for the whole page of staff
  // rather than one per row.
  findByOwnerIds(ownerUserIds: string[]): Promise<ReferralCodeEntity[]> {
    if (ownerUserIds.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { ownerUserId: In(ownerUserIds) },
      order: { createdAt: 'DESC' },
    });
  }

  async list(filters: {
    ownerUserId?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ items: ReferralCodeEntity[]; total: number }> {
    const { ownerUserId, search, page, limit } = filters;

    const qb = this.repo
      .createQueryBuilder('referralCode')
      .orderBy('referralCode.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (ownerUserId) {
      qb.andWhere('referralCode.owner_user_id = :ownerUserId', { ownerUserId });
    }
    if (search) {
      qb.andWhere('referralCode.code ILIKE :search', { search: `%${search}%` });
    }

    const [items, total] = await qb.getManyAndCount();

    if (items.length > 0) {
      const referralCodeIds = items.map((item) => item.id);
      const countRows = await this.repo.manager
        .getRepository(OrganizationEntity)
        .createQueryBuilder('organization')
        .select('organization.referral_code_id', 'referralCodeId')
        .addSelect('COUNT(*)', 'count')
        .where('organization.referral_code_id IN (:...referralCodeIds)', { referralCodeIds })
        .groupBy('organization.referral_code_id')
        .getRawMany<{ referralCodeId: string; count: string }>();

      const countsByReferralCodeId = new Map(
        countRows.map((row) => [row.referralCodeId, Number(row.count)]),
      );
      for (const item of items) {
        item.totalSignup = countsByReferralCodeId.get(item.id) ?? 0;
      }
    }

    return { items, total };
  }

  async update(
    id: string,
    data: Partial<{ ownerUserId: string; validUntil: string | null; revokedAt: Date | null }>,
  ): Promise<ReferralCodeEntity | null> {
    await this.repo.update({ id }, data);
    return this.repo.findOneBy({ id });
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
