import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService } from '../organization/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { createAdminRoutes } from './admin.routes';
import { DataSource } from 'typeorm';
import { RoleService } from '../roles/role.service';
import { StaffImportRepository } from './staff-import.repository';
import { StaffImportService } from './staff-import.service';
import { StaffImportController } from './staff-import.controller';

export function createAdminModule(deps: {
  organizationService: OrganizationService;
  organizationDocumentService: OrganizationDocumentService;
  organizationJourneyStageService: OrganizationJourneyStageService;
  authService: AuthService;
  referralCodeService: ReferralCodeService;
  auditService: AuditService;
  dataSource: DataSource;
  roleService: RoleService;
}) {
  const service = new AdminService(
    deps.organizationService,
    deps.organizationDocumentService,
    deps.organizationJourneyStageService,
    deps.authService,
    deps.referralCodeService,
    deps.auditService,
  );
  const staffImportService = new StaffImportService(
    new StaffImportRepository(deps.dataSource),
    deps.authService,
    deps.roleService,
    deps.auditService,
    deps.dataSource,
  );
  const staffImportController = new StaffImportController(staffImportService);
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller, staffImportController);

  return { router };
}
