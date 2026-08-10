import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService } from '../organization/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { createAdminRoutes } from './admin.routes';

export function createAdminModule(deps: {
  organizationService: OrganizationService;
  organizationDocumentService: OrganizationDocumentService;
  organizationJourneyStageService: OrganizationJourneyStageService;
  authService: AuthService;
  referralCodeService: ReferralCodeService;
  auditService: AuditService;
}) {
  const service = new AdminService(
    deps.organizationService,
    deps.organizationDocumentService,
    deps.organizationJourneyStageService,
    deps.authService,
    deps.referralCodeService,
    deps.auditService,
  );
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller);

  return { router };
}
