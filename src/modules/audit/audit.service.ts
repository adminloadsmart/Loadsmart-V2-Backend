import { AuditRepository } from './audit.repository';

export interface AuditLogInput {
    tenantId: string | null;
    userId: string | null;
    action: string;
    resourceType?: string | null;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

export class AuditService {
    constructor(private readonly auditRepository: AuditRepository) { }

    async log(entry: AuditLogInput): Promise<void> {
        await this.auditRepository.create({
            tenantId: entry.tenantId,
            userId: entry.userId,
            action: entry.action,
            resource_type: entry.resourceType ?? null,
            old_data: entry.oldData ?? null,
            new_data: entry.newData ?? null,
            ip_address: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
        });
    }
}
