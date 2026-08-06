import { DataSource } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';


export function createAuditModule(dataSource: DataSource) {
    const repository = new AuditRepository(dataSource);
    const service = new AuditService(repository);
    return { service };
}
