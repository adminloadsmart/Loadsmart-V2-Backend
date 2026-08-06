import { DataSource } from 'typeorm';
import { TenancyGatewayLocal } from '../../shared/tenancy/tenancy.gateway.local';
import { AuditService } from '../audit/audit.service';
import { RoleService } from '../roles/role.service';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { createAuthPublicRoutes, createAuthProtectedRoutes } from './auth.routes';

export function createAuthModule(dataSource: DataSource, deps: { auditService: AuditService; roleService: RoleService }) {
  const organizationRepository = new OrganizationRepository(dataSource);
  const organizationService = new OrganizationService(organizationRepository);

  const repository = new AuthRepository(dataSource);
  const service = new AuthService(repository, organizationService, deps.roleService, deps.auditService, dataSource);
  const controller = new AuthController(service);
  const publicRouter = createAuthPublicRoutes(controller);
  const protectedRouter = createAuthProtectedRoutes(controller);
  const tenancyGateway = new TenancyGatewayLocal(organizationService);

  return {
    service,
    publicRouter,
    protectedRouter,
    tenancyGateway,
    authRepository: repository,
    organizationService,
  };
}
