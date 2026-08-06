import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';
import { RoleController } from './role.controller';
import { createRoleRoutes } from './role.routes';

// Owns the roles/permissions schema end to end: entities, repository, service, and this API
// layer. Returns `service` alongside `router` so modules/auth/ can take it as a constructor
// dependency for building the JWT's `permissions` claim — the same "read another module's
// service directly, no gateway" pattern modules/admin/ already uses for auth's
// organizationService (this is a cross-tenant-capable read/write, not a producer/consumer
// integration between two independently-owned domains).
export function createRolesModule(dataSource: DataSource, deps: { auditService: AuditService }) {
  const repository = new RoleRepository(dataSource);
  const service = new RoleService(repository, deps.auditService);
  const controller = new RoleController(service);
  const router = createRoleRoutes(controller);

  return { router, service };
}
