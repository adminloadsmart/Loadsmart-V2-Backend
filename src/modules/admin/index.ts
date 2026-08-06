import { OrganizationService } from '../auth/organization.service';
import { OrganizationDocumentService } from '../auth/organization-document.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService } from '../auth/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { createAdminRoutes } from './admin.routes';

export function createAdminModule(deps: {
  organizationService: OrganizationService;
  organizationDocumentService: OrganizationDocumentService;
  authService: AuthService;
  referralCodeService: ReferralCodeService;
  auditService: AuditService;
}) {
  const service = new AdminService(
    deps.organizationService,
    deps.organizationDocumentService,
    deps.authService,
    deps.referralCodeService,
    deps.auditService,
  );
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller);

  return { router };
}
