import { DataSource } from 'typeorm';
import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { AuthService } from '../auth/auth.service';
import { ReferralCodeService } from '../organization/referral-code.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotifyByType } from '../notifications/notify-by-type';
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
  storageService: StorageService;
  dataSource: DataSource;
  // LS_N_0001 "account approved" — see admin.service.ts's approveOrganization.
  notifyByType: NotifyByType;
}) {
  const service = new AdminService(
    deps.organizationService,
    deps.organizationDocumentService,
    deps.organizationJourneyStageService,
    deps.authService,
    deps.referralCodeService,
    deps.auditService,
    deps.storageService,
    deps.dataSource,
    deps.notifyByType,
  );
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller);

  return { router };
}
