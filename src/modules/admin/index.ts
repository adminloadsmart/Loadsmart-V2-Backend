import { DataSource } from 'typeorm';
import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationDocumentVerificationService } from '../organization/organization-document-verification.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService } from '../organization/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationTriggers } from '../notifications/notification-triggers';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { createAdminRoutes } from './admin.routes';

export function createAdminModule(deps: {
  organizationService: OrganizationService;
  organizationDocumentService: OrganizationDocumentService;
  documentVerificationService: OrganizationDocumentVerificationService;
  organizationJourneyStageService: OrganizationJourneyStageService;
  authService: AuthService;
  referralCodeService: ReferralCodeService;
  auditService: AuditService;
  storageService: StorageService;
  dataSource: DataSource;
  // LS_N_0001 "account approved" — see admin.service.ts's approveOrganization.
  notificationTriggers: NotificationTriggers;
}) {
  const service = new AdminService(
    deps.organizationService,
    deps.organizationDocumentService,
    deps.documentVerificationService,
    deps.organizationJourneyStageService,
    deps.authService,
    deps.referralCodeService,
    deps.auditService,
    deps.storageService,
    deps.dataSource,
    deps.notificationTriggers,
  );
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller);

  // service exposed for composition-root.ts's notification relevance checks (LS_N_0003).
  return { router, service };
}
