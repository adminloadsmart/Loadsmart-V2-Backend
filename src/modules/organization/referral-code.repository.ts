import { DataSource, EntityManager, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { ReferralCodeEntity } from './entities/referral-code.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { ReferralCodeSummary, ReferralSignupCounts } from './organization.types';

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

    // The owner's name rides along, so the admin list doesn't have to look it up in a page of
    // sales staff (a removed or reassigned owner would otherwise show as unknown).
    const qb = this.repo
      .createQueryBuilder('referralCode')
      .leftJoin('referralCode.owner', 'owner')
      .addSelect(['owner.id', 'owner.fullName', 'owner.coverage', 'owner.deletedAt'])
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
    const counts = await this.countSignups(items.map((item) => item.id));
    for (const item of items) {
      const signups = counts.get(item.id);
      item.totalSignup = signups?.total ?? 0;
      item.approvedSignup = signups?.approved ?? 0;
    }

    return { items, total };
  }

  /** Signups = submitted orgs that redeemed the code (never-submitted drafts left out);
   *  approved = those now active. Same definition as the Employees screen's counts. */
  async countSignups(referralCodeIds: string[]): Promise<Map<string, ReferralSignupCounts>> {
    if (referralCodeIds.length === 0) return new Map();
    const rows = await this.repo.manager
      .getRepository(OrganizationEntity)
      .createQueryBuilder('organization')
      .select('organization.referral_code_id', 'referralCodeId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE organization.status = :approvedStatus)', 'approved')
      .where('organization.referral_code_id IN (:...referralCodeIds)', { referralCodeIds })
      .andWhere('organization.status <> :draftStatus', { draftStatus: 'draft' })
      .setParameter('approvedStatus', 'active')
      .groupBy('organization.referral_code_id')
      .getRawMany<{ referralCodeId: string; total: string; approved: string }>();
    return new Map(
      rows.map((row) => [
        row.referralCodeId,
        { total: Number(row.total), approved: Number(row.approved) },
      ]),
    );
  }

  /** Counts for the admin Referral Codes cards — status as resolveReferralCodeStatus derives it,
   *  with `today` passed in so both agree on the date. */
  async summarize(today: string): Promise<ReferralCodeSummary> {
    const [total, revoked, expired] = await Promise.all([
      this.repo.count(),
      this.repo.count({ where: { revokedAt: Not(IsNull()) } }),
      this.repo.count({ where: { revokedAt: IsNull(), validUntil: LessThan(today) } }),
    ]);
    return { total, active: total - revoked - expired, expired, revoked };
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
