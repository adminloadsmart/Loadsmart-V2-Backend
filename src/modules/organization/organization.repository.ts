import {
  Between,
  Brackets,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  Not,
  Repository,
} from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { ONE_DAY_MS, resolveDateRange } from '../../shared/utils/date-filter';
import {
  OrganizationListFilters,
  OrganizationQueueSummary,
  ReferralSignupCounts,
} from './organization.types';
import {
  OrganizationEntity,
  OrganizationJourneyStage,
  OrganizationOnboardingStep,
  OrganizationStatus,
} from './entities/organization.entity';

export class OrganizationRepository {
  private readonly repo: Repository<OrganizationEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(OrganizationEntity);
  }

  async create(
    name: string | null,
    status: OrganizationStatus = 'pending',
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const repo = manager ? manager.getRepository(OrganizationEntity) : this.repo;
    const organization = repo.create({ name, status, onboardingStep: 'company_details' });
    return repo.save(organization);
  }

  async findById(id: string, manager?: EntityManager): Promise<OrganizationEntity | null> {
    const repo = manager ? manager.getRepository(OrganizationEntity) : this.repo;
    return repo.findOne({
      where: { id },
      relations: {
        referralCode: true,
        onlineKycVerifier: true,
        physicalKycAgent: true,
      },
      select: {
        referralCode: {
          id: true,
          code: true,
        },
        onlineKycVerifier: {
          id: true,
          fullName: true,
          email: true,
        },
        physicalKycAgent: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    });
  }

  // Driver-app join-request target search — name + id only, no sensitive KYC/contact fields, and
  // restricted to fully active orgs (a driver shouldn't be able to request joining a fleet owner
  // still mid-onboarding). See driver-relations.service.ts. Matches by org name OR by any of that
  // org's staff members' phone number (org_admin included) — a driver often knows the fleet
  // owner's contact number without knowing the exact registered company name. Joins through the
  // real staffUsers relation (see organization.entity.ts) rather than a manual entity+condition
  // join, so property names below (staffUser.deletedAt/phoneNumber) resolve through TypeORM's own
  // metadata instead of hand-written column names.
  async searchActiveByNameOrPhone(
    query: string,
    limit: number,
  ): Promise<{ id: string; name: string }[]> {
    const normalizedPhone = query.replace(/[\s-]/g, '');
    const results = await this.repo
      .createQueryBuilder('org')
      .leftJoin('org.staffUsers', 'staffUser', 'staffUser.deletedAt IS NULL')
      .where('org.status = :status', { status: 'active' })
      .andWhere(
        new Brackets((qb) => {
          qb.where('org.name ILIKE :name', { name: `%${query}%` }).orWhere(
            'staffUser.phoneNumber ILIKE :phone',
            { phone: `%${normalizedPhone}%` },
          );
        }),
      )
      .select(['org.id AS id', 'org.name AS name'])
      .distinct(true)
      .orderBy('org.name', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string; name: string | null }>();
    return results.map((org) => ({ id: org.id, name: org.name ?? '' }));
  }

  async list(
    filters: OrganizationListFilters & { page: number; limit: number },
  ): Promise<{ items: OrganizationEntity[]; total: number }> {
    const { page, limit } = filters;
    const where = this.buildListWhere(filters);
    // Counted separately: findAndCount's count query miscounts with the partial referralCode
    // select once a page is short of the full result (e.g. total 4 for 38 rows at limit 10).
    const [items, total] = await Promise.all([
      this.repo.find({
        where,
        relations: { referralCode: true },
        select: { referralCode: { id: true, code: true } },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.repo.count({ where }),
    ]);

    return { items, total };
  }

  /** Counts for the verification queue's tabs and summary cards — same filters as list(). */
  async summarize(filters: OrganizationListFilters): Promise<OrganizationQueueSummary> {
    const scoped = { ...filters, status: undefined, excludeDrafts: true };
    const count = (extra: FindOptionsWhere<OrganizationEntity>, overrides = {}) =>
      this.repo.count({ where: this.buildListWhere({ ...scoped, ...overrides }, extra) });
    const today = resolveDateRange('today')!;

    const [total, pending, partialPending, approved, rejected, overdue, approvedToday] =
      await Promise.all([
        count({}),
        count({ status: 'pending' }),
        count({ status: 'partial_pending' }),
        count({ status: 'active' }),
        count({ status: In(['rejected', 'suspended']) }),
        count({
          status: 'pending',
          submittedAt: LessThan(new Date(Date.now() - ONE_DAY_MS)),
        }),
        count(
          { status: 'active', approvedAt: Between(today.from, today.to) },
          { filter: undefined, from: undefined, to: undefined },
        ),
      ]);
    return { total, pending, partialPending, approved, rejected, overdue, approvedToday };
  }

  // `extra` is merged into every OR-branch (search matches on name OR legal name).
  private buildListWhere(
    filters: OrganizationListFilters,
    extra: FindOptionsWhere<OrganizationEntity> = {},
  ): FindOptionsWhere<OrganizationEntity>[] {
    const {
      status,
      excludeDrafts,
      journeyStage,
      search,
      filter,
      from,
      to,
      onlineKycVerifierId,
      physicalKycAgentId,
      onlineKycCompleted,
    } = filters;

    const base: FindOptionsWhere<OrganizationEntity> = {};
    const statuses = (status === undefined ? [] : [status].flat()).filter(
      (candidate) => !excludeDrafts || candidate !== 'draft',
    );
    if (statuses.length) base.status = statuses.length === 1 ? statuses[0] : In(statuses);
    else if (excludeDrafts) base.status = Not('draft');
    if (journeyStage) base.journeyStage = journeyStage;
    if (onlineKycVerifierId) base.onlineKycVerifierId = onlineKycVerifierId;
    if (physicalKycAgentId) base.physicalKycAgentId = physicalKycAgentId;
    if (onlineKycCompleted) base.onlineKycCompletedAt = Not(IsNull());
    const range = resolveDateRange(filter, from, to);
    if (range) base.createdAt = Between(range.from, range.to);
    Object.assign(base, extra);

    return search
      ? [
          { ...base, name: ILike(`%${search}%`) },
          { ...base, companyLegalName: ILike(`%${search}%`) },
        ]
      : [base];
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      status: OrganizationStatus;
      companyLegalName: string | null;
      registeredBusinessName: string | null;
      orgAdminName: string | null;
      operationalCity: string | null;
      referralCodeId: string | null;
      onboardingStep: OrganizationOnboardingStep | null;
      shopboardPremisesPhotoKey: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      landmark: string | null;
      areaLocality: string | null;
      city: string | null;
      district: string | null;
      state: string | null;
      pinCode: string | null;
      hasOwnFleet: boolean | null;
      lateDeliveryThresholdMinutes: number | null;
      onlineKycVerifierId: string | null;
      physicalKycAgentId: string | null;
      onlineKycCompletedAt: Date | null;
      physicalKycApprovedAt: Date | null;
      decisionReason: string | null;
      submittedAt: Date | null;
      journeyStage: OrganizationJourneyStage | null;
    }>,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const repo = manager ? manager.getRepository(OrganizationEntity) : this.repo;
    await repo.update({ id }, data);
    const organization = await repo.findOneBy({ id });
    if (!organization) {
      throw new NotFoundError(`Organization ${id} not found`);
    }
    return organization;
  }

  // Used by AdminService.deleteReferralCode to block hard-deleting a code that's already
  // attributed to at least one organization — attribution history has to survive, so revoke is
  // the only option once this is non-zero.
  countByReferralCodeId(referralCodeId: string): Promise<number> {
    return this.repo.count({ where: { referralCodeId } });
  }

  // Batched for AuthService.listStaffUsers — one grouped query for the whole page of staff,
  // keyed by referral-code owner id. Signups = submitted orgs (drafts left out) that used any
  // of the owner's codes; approved = those now 'active' — same definition as the Referral Codes
  // list (ReferralCodeRepository.countSignups).
  async countSignupsByReferralCodeOwnerIds(
    ownerUserIds: string[],
  ): Promise<Map<string, ReferralSignupCounts>> {
    if (ownerUserIds.length === 0) return new Map();
    const rows = await this.repo
      .createQueryBuilder('org')
      .innerJoin('org.referralCode', 'rc')
      .where('rc.owner_user_id IN (:...ownerUserIds)', { ownerUserIds })
      .andWhere('org.status <> :draftStatus', { draftStatus: 'draft' })
      .select('rc.owner_user_id', 'ownerUserId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE org.status = :approvedStatus)', 'approved')
      .setParameter('approvedStatus', 'active')
      .groupBy('rc.owner_user_id')
      .getRawMany<{ ownerUserId: string; total: string; approved: string }>();
    return new Map(
      rows.map((row) => [
        row.ownerUserId,
        { total: Number(row.total), approved: Number(row.approved) },
      ]),
    );
  }

  // Batched for AuthService.listStaffUsers — "workload" here means KYC review assignments not
  // yet completed, the only staff-assignment relationship this schema has (see
  // onlineKycVerifierId/physicalKycAgentId on OrganizationEntity). Staff outside the
  // online_kyc_desk/offline_kyc_desk roles never appear as either, so they end up with 0.
  async countPendingKycAssignmentsByStaffIds(staffIds: string[]): Promise<Map<string, number>> {
    if (staffIds.length === 0) return new Map();
    const [onlineRows, physicalRows] = await Promise.all([
      this.repo
        .createQueryBuilder('org')
        .where('org.online_kyc_verifier_id IN (:...staffIds)', { staffIds })
        .andWhere('org.online_kyc_completed_at IS NULL')
        .select('org.online_kyc_verifier_id', 'staffId')
        .addSelect('COUNT(*)', 'count')
        .groupBy('org.online_kyc_verifier_id')
        .getRawMany<{ staffId: string; count: string }>(),
      this.repo
        .createQueryBuilder('org')
        .where('org.physical_kyc_agent_id IN (:...staffIds)', { staffIds })
        .andWhere('org.physical_kyc_approved_at IS NULL')
        .select('org.physical_kyc_agent_id', 'staffId')
        .addSelect('COUNT(*)', 'count')
        .groupBy('org.physical_kyc_agent_id')
        .getRawMany<{ staffId: string; count: string }>(),
    ]);
    const byStaff = new Map<string, number>();
    for (const row of [...onlineRows, ...physicalRows]) {
      byStaff.set(row.staffId, (byStaff.get(row.staffId) ?? 0) + Number(row.count));
    }
    return byStaff;
  }
}
