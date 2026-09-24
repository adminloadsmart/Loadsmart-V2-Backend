import { DataSource } from 'typeorm';
import { createDriverAuth } from '../../shared/middleware/driver-auth.middleware';
import { DriverRepository } from './driver.repository';
import { DriverTenantRelationRepository } from './driver-tenant-relation.repository';
import { DriverService } from './driver.service';
import { DriverController } from './driver.controller';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { SarathiClient, DlVerificationClient } from '../../adapters/sarathi.client';
import { OtpService } from '../../shared/services/otp.service';
import { OrganizationService } from '../organization/organization.service';
import { LoadService } from '../loads/load.service';
import { DriverSessionRepository } from './driver-auth.repository';
import { DriverPushNotifier } from './driver-push-notifier';
import { DriverAuthService } from './driver-auth.service';
import { DriverAuthController } from './driver-auth.controller';
import {
  createDriverAuthPublicRoutes,
  createDriverAuthProtectedRoutes,
} from './driver-auth.routes';
import { DriverPortalController } from './driver-portal.controller';
import { createDriverPortalRoutes } from './driver-portal.routes';
import { DriverIdentityService } from './driver-identity.service';
import { NotifyByType } from '../notifications/notify-by-type';

// Driver is its own top-level module (promoted out of masters/) — see docs/driver-auth.md for
// why: it owns both the staff-facing master-data CRUD below (unchanged behavior, still composed
// into masters.routes.ts's /v1/masters/drivers/... router by composition-root.ts) and the
// driver-app-facing auth/self-service layer (driver-auth.*, driver-portal.*), which is a
// genuinely separate identity domain from auth.users/roles and gets its own composition-root
// wiring — see driver-auth.ts/driver-portal.ts and composition-root.ts.
export function createDriverModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    storageService: StorageService;
    organizationService: OrganizationService;
  },
) {
  const driverRepository = new DriverRepository(dataSource);
  const driverTenantRelationRepository = new DriverTenantRelationRepository(dataSource);
  const sarathiClient = new SarathiClient();
  const driverPushNotifier = new DriverPushNotifier(new DriverSessionRepository(dataSource));
  const driverService = new DriverService(
    driverRepository,
    driverTenantRelationRepository,
    dataSource,
    sarathiClient,
    deps.auditService,
    deps.storageService,
    deps.organizationService,
    driverPushNotifier,
  );
  const driverController = new DriverController(driverService);

  return {
    driverRepository,
    driverTenantRelationRepository,
    driverService,
    driverController,
    dlVerificationClient: sarathiClient,
  };
}

// The driver-app auth/session layer — built separately from createDriverModule above (same
// driverRepository/driverTenantRelationRepository instances, passed in) since it needs
// organizationService (org-active login check, same as auth.service.ts's) and the shared
// otpService, neither of which the staff-facing module needs. See docs/driver-auth.md.
//
// Only builds the service here, not the controller/routers: the controller also serves
// self-registration (requestRegisterOtp/verifyRegisterOtp/register), which needs
// DriverIdentityService — and DriverIdentityService itself needs this service (to issue an
// identity session on registerSelf). So the controller/routers are built by
// createDriverIdentityModule below, once both services exist.
export function createDriverAuthModule(
  dataSource: DataSource,
  deps: {
    driverRepository: DriverRepository;
    driverTenantRelationRepository: DriverTenantRelationRepository;
    organizationService: OrganizationService;
    otpService: OtpService;
  },
) {
  const driverSessionRepository = new DriverSessionRepository(dataSource);
  const service = new DriverAuthService(
    deps.driverRepository,
    deps.driverTenantRelationRepository,
    driverSessionRepository,
    deps.organizationService,
    deps.otpService,
  );

  return { service, driverSessionRepository };
}

// The driver's own (tenant-independent) identity layer — login, self-registration, and
// cross-tenant relation management. Built after driverAuth (registerSelf issues sessions through
// driverAuthService.issueIdentitySession) and after masters/notifications exist (requestJoin/
// respondToInvite notify fleet-owner staff via notifyByType). Also builds the merged
// DriverAuthController/routers: login, self-registration, and relation management are all entry
// points into this one identity domain, so they share a controller and router pair instead of
// separate driver-registration/driver-relations modules.
export function createDriverIdentityModule(
  dataSource: DataSource,
  deps: {
    driverRepository: DriverRepository;
    driverTenantRelationRepository: DriverTenantRelationRepository;
    dlVerificationClient: DlVerificationClient;
    otpService: OtpService;
    storageService: StorageService;
    organizationService: OrganizationService;
    driverAuthService: DriverAuthService;
    auditService: AuditService;
    notifyByType: NotifyByType;
  },
) {
  const service = new DriverIdentityService(
    deps.driverRepository,
    deps.driverTenantRelationRepository,
    dataSource,
    deps.dlVerificationClient,
    deps.otpService,
    deps.storageService,
    deps.organizationService,
    deps.driverAuthService,
    deps.auditService,
    deps.notifyByType,
  );

  const authController = new DriverAuthController(
    deps.driverAuthService,
    service,
    deps.organizationService,
    deps.storageService,
  );
  const authPublicRouter = createDriverAuthPublicRoutes(authController);
  // requireTenant: false — logout/device-token/select-relation/relations/* must also work from an
  // identity-scoped session (a registered driver with no active tenant relation yet).
  const authProtectedRouter = createDriverAuthProtectedRoutes(
    authController,
    createDriverAuth(deps.driverRepository, deps.driverTenantRelationRepository, {
      requireTenant: false,
    }),
  );

  return { service, authPublicRouter, authProtectedRouter };
}

// The driver-app self-service layer — built last, after `loads` exists, since "my loads" reads
// loads.LoadService directly (no repository of its own — see driver-portal.controller.ts). Same
// "consumer takes producer services directly" pattern dashboards/index.ts already uses.
// storageService backs the driver's own upload handshake (requestUploadUrl/confirmUpload) — the
// same instance already passed into createDriverModule above. loadService also backs "Report An
// Issue" (reportMyIssue). Tenant-scoped (requireTenant: true) for every route except GET /me,
// which also accepts an identity-access token (requireTenant: false) — see
// driver-portal.routes.ts's comment.
export function createDriverPortalModule(deps: {
  driverRepository: DriverRepository;
  driverTenantRelationRepository: DriverTenantRelationRepository;
  driverService: DriverService;
  loadService: LoadService;
  storageService: StorageService;
}) {
  const controller = new DriverPortalController(
    deps.driverService,
    deps.loadService,
    deps.storageService,
  );
  const router = createDriverPortalRoutes(
    controller,
    createDriverAuth(deps.driverRepository, deps.driverTenantRelationRepository),
    createDriverAuth(deps.driverRepository, deps.driverTenantRelationRepository, {
      requireTenant: false,
    }),
  );

  return { router };
}
