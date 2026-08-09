import { DataSource } from 'typeorm';
import { TenancyGatewayLocal } from '../../shared/tenancy/tenancy.gateway.local';
import { AuditService } from '../audit/audit.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { ReferralCodeService } from '../organization/referral-code.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { createAuthPublicRoutes, createAuthProtectedRoutes } from './auth.routes';

export function createAuthModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    roleService: RoleService;
    // Read from modules/organization/ directly — no gateway, per the pattern modules/admin/
    // already uses for these same services (cross-tenant-capable read/write, not a
    // producer/consumer integration between independently-owned domains).
    organizationService: OrganizationService;
    organizationDocumentService: OrganizationDocumentService;
    referralCodeService: ReferralCodeService;
  },
) {
  const repository = new AuthRepository(dataSource);
  const service = new AuthService(
    repository,
    deps.organizationService,
    deps.organizationDocumentService,
    deps.referralCodeService,
    deps.roleService,
    deps.auditService,
    dataSource,
  );
  const controller = new AuthController(service);
  const publicRouter = createAuthPublicRoutes(controller);
  const protectedRouter = createAuthProtectedRoutes(controller);
  const tenancyGateway = new TenancyGatewayLocal(deps.organizationService);

  return {
    service,
    publicRouter,
    protectedRouter,
    tenancyGateway,
    authRepository: repository,
  };
}
