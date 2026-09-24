import {
  Between,
  Brackets,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { DateFilter, resolveDateRange } from '../../shared/utils/date-filter';
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

  async list(filters: {
    status?: OrganizationStatus;
    journeyStage?: OrganizationJourneyStage;
    search?: string;
    filter?: DateFilter;
    from?: string;
    to?: string;
    page: number;
    limit: number;
    // Role-scoping — see AdminService.listOrganizations, the only caller that sets these (for
    // online_kyc_desk/offline_kyc_desk callers; platform_admin leaves them undefined).
    onlineKycVerifierId?: string;
    physicalKycAgentId?: string;
    onlineKycCompleted?: boolean;
  }): Promise<{ items: OrganizationEntity[]; total: number }> {
    const {
      status,
      journeyStage,
      search,
      filter,
      from,
      to,
      page,
      limit,
      onlineKycVerifierId,
      physicalKycAgentId,
      onlineKycCompleted,
    } = filters;

    const base: FindOptionsWhere<OrganizationEntity> = {};
    if (status) base.status = status;
    if (journeyStage) base.journeyStage = journeyStage;
    if (onlineKycVerifierId) base.onlineKycVerifierId = onlineKycVerifierId;
    if (physicalKycAgentId) base.physicalKycAgentId = physicalKycAgentId;
    if (onlineKycCompleted) base.onlineKycCompletedAt = Not(IsNull());
    const range = resolveDateRange(filter, from, to);
    if (range) base.createdAt = Between(range.from, range.to);

    const where: FindOptionsWhere<OrganizationEntity>[] = search
      ? [
          { ...base, name: ILike(`%${search}%`) },
          { ...base, companyLegalName: ILike(`%${search}%`) },
        ]
      : [base];

    const [items, total] = await this.repo.findAndCount({
      where,
      relations: { referralCode: true },
      select: { referralCode: { id: true, code: true } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
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
  // keyed by referral-code owner id. Only counts fully approved orgs ('active'), unlike
  // countByReferralCodeId above which counts any status.
  async countActiveByReferralCodeOwnerIds(ownerUserIds: string[]): Promise<Map<string, number>> {
    if (ownerUserIds.length === 0) return new Map();
    const rows = await this.repo
      .createQueryBuilder('org')
      .innerJoin('org.referralCode', 'rc')
      .where('rc.owner_user_id IN (:...ownerUserIds)', { ownerUserIds })
      .andWhere('org.status = :status', { status: 'active' })
      .select('rc.owner_user_id', 'ownerUserId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rc.owner_user_id')
      .getRawMany<{ ownerUserId: string; count: string }>();
    return new Map(rows.map((row) => [row.ownerUserId, Number(row.count)]));
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
