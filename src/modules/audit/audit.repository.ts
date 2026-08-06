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
}
