import { Between, DataSource, EntityManager, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { DateFilter, resolveDateRange } from '../../shared/utils/date-filter';
import { OrganizationEntity, OrganizationStatus } from './entities/organization.entity';

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

  async findById(id: string): Promise<OrganizationEntity | null> {
    return this.repo.findOne({
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
    search?: string;
    filter?: DateFilter;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }): Promise<{ items: OrganizationEntity[]; total: number }> {
    const { status, search, filter, from, to, page, limit } = filters;

    const base: FindOptionsWhere<OrganizationEntity> = {};
    if (status) base.status = status;
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
      onboardingStep: import('./entities/organization.entity').OrganizationOnboardingStep | null;
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
      decisionReason: string | null;
      submittedAt: Date | null;
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
