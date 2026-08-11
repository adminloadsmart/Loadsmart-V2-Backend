import {
  Between,
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
      registrationDate: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      district: string | null;
      state: string | null;
      hasOwnFleet: boolean | null;
      fleetSize: number | null;
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
}
