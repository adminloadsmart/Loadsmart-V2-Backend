import { DataSource, EntityManager, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { OrganizationEntity, OrganizationStatus } from './entities/organization.entity';

export class OrganizationRepository {
    private readonly repo: Repository<OrganizationEntity>;

    constructor(dataSource: DataSource) {
        this.repo = dataSource.getRepository(OrganizationEntity);
    }

    async create(name: string | null, status: OrganizationStatus = 'pending', manager?: EntityManager): Promise<OrganizationEntity> {
        const repo = manager ? manager.getRepository(OrganizationEntity) : this.repo;
        const organization = repo.create({ name, status });
        return repo.save(organization);
    }

    async findById(id: string): Promise<OrganizationEntity | null> {
        return this.repo.findOneBy({ id });
    }

    async list(filters: {
        status?: OrganizationStatus;
        search?: string;
        page: number;
        limit: number;
    }): Promise<{ items: OrganizationEntity[]; total: number }> {
        const { status, search, page, limit } = filters;

        const base: FindOptionsWhere<OrganizationEntity> = {};
        if (status) base.status = status;

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
            orgAdminName: string | null;
            operationalCity: string | null;
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
}
