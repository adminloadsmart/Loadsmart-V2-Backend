import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLogEntity } from './audit.entity';

export class AuditRepository {
  private readonly repo: Repository<AuditLogEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(AuditLogEntity);
  }

  // manager lets a caller running inside dataSource.transaction(...) log against the same
  // transaction (see organization.repository.ts for the identical pattern) — without it, logging
  // a row that references something created earlier in that same uncommitted transaction (e.g.
  // the org a signup just created) hits a separate connection that can't see it yet and fails an
  // FK check every time, not just under contention.
  async create(data: Partial<AuditLogEntity>, manager?: EntityManager): Promise<AuditLogEntity> {
    const repo = manager ? manager.getRepository(AuditLogEntity) : this.repo;
    const entity = repo.create(data);
    return repo.save(entity);
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
