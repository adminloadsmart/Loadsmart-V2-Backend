import { DataSource } from 'typeorm';
import { createDriverAuth } from '../../shared/middleware/driver-auth.middleware';
import { DriverRepository } from './driver.repository';
import { DriverService } from './driver.service';
import { DriverController } from './driver.controller';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { SarathiClient } from '../../adapters/sarathi.client';
import { OtpService } from '../../shared/services/otp.service';
import { OrganizationService } from '../organization/organization.service';
import { LoadService } from '../loads/load.service';
import { DriverSessionRepository } from './driver-auth.repository';
import { DriverAuthService } from './driver-auth.service';
import { DriverAuthController } from './driver-auth.controller';
import {
  createDriverAuthPublicRoutes,
  createDriverAuthProtectedRoutes,
} from './driver-auth.routes';
import { DriverPortalController } from './driver-portal.controller';
import { createDriverPortalRoutes } from './driver-portal.routes';

// Driver is its own top-level module (promoted out of masters/) — see docs/driver-auth.md for
// why: it owns both the staff-facing master-data CRUD below (unchanged behavior, still composed
// into masters.routes.ts's /v1/masters/drivers/... router by composition-root.ts) and the
// driver-app-facing auth/self-service layer (driver-auth.*, driver-portal.*), which is a
// genuinely separate identity domain from auth.users/roles and gets its own composition-root
// wiring — see driver-auth.ts/driver-portal.ts and composition-root.ts.
export function createDriverModule(
  dataSource: DataSource,
  deps: { auditService: AuditService; storageService: StorageService },
) {
  const driverRepository = new DriverRepository(dataSource);
  const sarathiClient = new SarathiClient();
  const driverService = new DriverService(
    driverRepository,
    dataSource,
    sarathiClient,
    deps.auditService,
    deps.storageService,
  );
  const driverController = new DriverController(driverService);

  return { driverRepository, driverService, driverController };
}

// The driver-app auth/session layer — built separately from createDriverModule above (same
// driverRepository instance, passed in) since it needs organizationService (org-active login
// check, same as auth.service.ts's) and the shared otpService, neither of which the staff-facing
// module needs. See docs/driver-auth.md.
export function createDriverAuthModule(
  dataSource: DataSource,
  deps: {
    driverRepository: DriverRepository;
    organizationService: OrganizationService;
    otpService: OtpService;
  },
) {
  const driverSessionRepository = new DriverSessionRepository(dataSource);
  const service = new DriverAuthService(
    deps.driverRepository,
    driverSessionRepository,
    deps.organizationService,
    deps.otpService,
  );
  const controller = new DriverAuthController(service);
  const publicRouter = createDriverAuthPublicRoutes(controller);
  const protectedRouter = createDriverAuthProtectedRoutes(
    controller,
    createDriverAuth(deps.driverRepository),
  );

  return { service, driverSessionRepository, publicRouter, protectedRouter };
}

// The driver-app self-service layer — built last, after `loads` exists, since "my loads" reads
// loads.LoadService directly (no repository of its own — see driver-portal.controller.ts). Same
// "consumer takes producer services directly" pattern dashboards/index.ts already uses.
export function createDriverPortalModule(deps: {
  driverRepository: DriverRepository;
  driverService: DriverService;
  loadService: LoadService;
}) {
  const controller = new DriverPortalController(deps.driverService, deps.loadService);
  const router = createDriverPortalRoutes(controller, createDriverAuth(deps.driverRepository));

  return { router };
}
