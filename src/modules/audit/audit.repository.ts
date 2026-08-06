import { DataSource, Repository } from 'typeorm';
import { AuditLogEntity } from './audit.entity';

export class AuditRepository {
    private readonly repo: Repository<AuditLogEntity>;

    constructor(dataSource: DataSource) {
        this.repo = dataSource.getRepository(AuditLogEntity);
    }

    async create(data: Partial<AuditLogEntity>): Promise<AuditLogEntity> {
        const entity = this.repo.create(data);
        return this.repo.save(entity);
    }

    findById(id: string): Promise<AuditLogEntity | null> {
        return this.repo.findOneBy({ id });
    }

    // AuditLogEntity.tenantId is joined 1:1 to an organization's id (same convention as
    // UserEntity.tenantId — see audit.entity.ts) — no separate "organizationId" column needed.
    async findByOrganization(
        organizationId: string,
        pagination: { page: number; limit: number },
    ): Promise<{ items: AuditLogEntity[]; total: number }> {
        const { page, limit } = pagination;
        const [items, total] = await this.repo.findAndCount({
            where: { tenantId: organizationId },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { items, total };
    }
}
