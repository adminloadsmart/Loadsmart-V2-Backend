import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { AuditAction, AuditResourceType } from './audit.types';

export interface AuditLogInput {
  tenantId: string | null;
  userId: string | null;
  action: AuditAction;
  resourceType?: AuditResourceType | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class AuditService {
  constructor(private readonly auditRepository: AuditRepository) {}

  // manager: pass the transaction's EntityManager when logging something created/updated earlier
  // in that same transaction (e.g. an org a signup just created) — otherwise this writes through a
  // separate connection that can't see the uncommitted row yet and fails an FK check.
  async log(entry: AuditLogInput, manager?: EntityManager): Promise<void> {
    await this.auditRepository.create(
      {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resource_type: entry.resourceType ?? null,
        old_data: entry.oldData ?? null,
        new_data: entry.newData ?? null,
        ip_address: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
      manager,
    );
  }

  // Separate from log(): audit.middleware.ts's per-request access log stores the raw HTTP method
  // and path, not a business action — an open-ended value by nature, unlike the AuditAction/
  // AuditResourceType closed sets log() enforces, so it's kept off that stricter method instead of
  // widening AuditLogInput's typing back to a plain string.
  async logRequest(entry: {
    tenantId: string | null;
    userId: string | null;
    method: string;
    path: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.auditRepository.create({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.method,
      resource_type: entry.path,
      ip_address: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  }

  // Read-side passthrough so other modules (admin.service.ts's org audit trail) depend on
  // AuditService, not AuditRepository directly — same layering every other cross-module read in
  // this codebase already follows.
  findByOrganization(organizationId: string, pagination: { page: number; limit: number }) {
    return this.auditRepository.findByOrganization(organizationId, pagination);
  }
}
