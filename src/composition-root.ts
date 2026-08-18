import { Router, RequestHandler } from 'express';
import { DataSource } from 'typeorm';
import { TenancyGateway } from './shared/tenancy/tenancy.gateway';
import { createAuth } from './shared/middleware/auth.middleware';
import { createAudit } from './shared/middleware/audit.middleware';

import { createAuthModule } from './modules/auth';
import { AuthRepository } from './modules/auth/auth.repository';
import {
  createOrganizationModule,
  createOrganizationOnboardingRoutes,
} from './modules/organization';
import { createRolesModule } from './modules/roles';
import { createMastersModule } from './modules/masters';
import { createTrackingModule } from './modules/tracking';
import { createNotificationsModule } from './modules/notifications';
import { createPaymentsModule } from './modules/payments';
import { createMaintenanceModule } from './modules/maintenance';
import { createAuditModule } from './modules/audit';
import { createAdminModule } from './modules/admin';
import { createDashboardsModule } from './modules/dashboards';
import { createCustomersModule } from './modules/customers';
import { createStorageModule } from './modules/storage';
import { createLoadsModule } from './modules/loads';

import { NotificationsGatewayLocal as MaintenanceNotificationsGatewayLocal } from './modules/maintenance/gateways/notifications.gateway.local';

export interface Container {
  tenancyGateway: TenancyGateway;
  authMiddleware: RequestHandler;
  auditMiddleware: RequestHandler;
  publicRouters: { path: string; router: Router }[];
  // Authenticated but not yet tenant-scoped — routes that manage tenant existence itself
  // (or never needed a tenant at all) can't sit behind createTenantScope. See app.ts.
  authenticatedRouters: { path: string; router: Router }[];
  routers: { path: string; router: Router }[];
}

export function buildContainer(dataSource: DataSource): Container {
  // Standalone — no cross-module deps. Built before roles: role.service.ts needs auditService
  // injected to log role/permission changes with real old/new data.
  const audit = createAuditModule(dataSource);
  const auditMiddleware = createAudit(audit.service);

  // Built before auth: auth.service.ts needs roles's roleService injected directly to build the
  // JWT's `permissions` claim (see modules/auth/index.ts and modules/roles/index.ts). That same
  // build order means roles can't take a typed dependency on auth's AuthService/AuthRepository
  // (it doesn't exist yet). AuthRepository's constructor only needs `dataSource` though (no
  // other module's service), so it's safe to construct one standalone instance here purely to
  // hand role.service.ts a way to revoke a target user's refresh tokens when their role/
  // permissions change — createAuthModule below still builds and uses its own separate
  // AuthRepository instance as it always has.
  const earlyAuthRepository = new AuthRepository(dataSource);
  const roles = createRolesModule(dataSource, {
    auditService: audit.service,
    revokeRefreshTokensForUser: (userId) =>
      earlyAuthRepository.revokeAllRefreshTokensForUser(userId),
  });

  // Standalone — built before auth because the post-submission organization photo endpoint
  // validates an already-confirmed tenant-owned upload through storage.service.
  const storage = createStorageModule(dataSource);

  // No cross-module deps of its own — owns the organization/organization-document/referral-code
  // schema. Built before auth: auth.service.ts orchestrates org onboarding on top of these
  // services directly (see modules/auth/index.ts), the same "read another module's service
  // directly, no gateway" pattern modules/admin/ already used for these when they lived in auth.
  const organization = createOrganizationModule(dataSource);

  const auth = createAuthModule(dataSource, {
    auditService: audit.service,
    roleService: roles.service,
    organizationService: organization.organizationService,
    organizationDocumentService: organization.organizationDocumentService,
    organizationOnboardingService: organization.organizationOnboardingService,
    organizationJourneyStageService: organization.organizationJourneyStageService,
    referralCodeService: organization.referralCodeService,
    storageService: storage.service,
  });
  const authMiddleware = createAuth(auth.authRepository);

  // The org onboarding router (GET/POST /auth/organization*) — built here, not alongside
  // `organization` above, since it needs auth.service (createOrganization etc. also mutate the
  // caller's own session on first-time org creation). Mounted at '/auth' below, same URLs as
  // before this was its own router — see modules/organization/organization.routes.ts.
  const organizationOnboarding = createOrganizationOnboardingRoutes(auth.service);

  // Reference data other modules read from.
  const masters = createMastersModule(dataSource, {
    auditService: audit.service,
    storageService: storage.service,
  });

  // Producers first — no cross-module deps of their own.
  const tracking = createTrackingModule(dataSource);
  const notifications = createNotificationsModule(dataSource);
  const payments = createPaymentsModule(dataSource);

  // Consumers — each wired to a local gateway wrapping the producer(s) it needs.
  const maintenance = createMaintenanceModule(dataSource, {
    notificationsGateway: new MaintenanceNotificationsGatewayLocal(notifications.service),
  });

  // Reads organization's organizationService/organizationDocumentService/referralCodeService and
  // auth's authService directly — cross-tenant ops, not a producer/consumer integration, so no
  // gateway wrapper (see admin/index.ts).
  const admin = createAdminModule({
    organizationService: organization.organizationService,
    organizationDocumentService: organization.organizationDocumentService,
    organizationJourneyStageService: organization.organizationJourneyStageService,
    authService: auth.service,
    referralCodeService: organization.referralCodeService,
    auditService: audit.service,
  });

  // No cross-module deps of its own — built before dashboards, which reads its service directly
  // (Settings → Approvals aggregates pending customers alongside pending vehicles/drivers).
  const customers = createCustomersModule(dataSource, audit.service);

  // Built after customers/masters/storage — the Load module reads customers.service
  // (unloading-point validation) and masters' vehicle/transporter/truckType/loadingPoint/
  // product services (capacity matching + master-record validation) and storage.service
  // (invoice/e-way-bill/E-LR/E-POD uploads) directly, no gateway — same "consumer takes producer
  // services as direct constructor args" pattern dashboards uses below.
  const loads = createLoadsModule(dataSource, {
    auditService: audit.service,
    storageService: storage.service,
    customerService: customers.service,
    vehicleService: masters.vehicleService,
    transporterService: masters.transporterService,
    truckTypeService: masters.truckTypeService,
    loadingPointService: masters.loadingPointService,
    productService: masters.productService,
  });

  // Last — reads other modules' services directly.
  const dashboards = createDashboardsModule({
    vehicleService: masters.vehicleService,
    driverService: masters.driverService,
    customerService: customers.service,
  });

  return {
    tenancyGateway: auth.tenancyGateway,
    authMiddleware,
    auditMiddleware,
    publicRouters: [{ path: '/auth', router: auth.publicRouter }],
    authenticatedRouters: [
      { path: '/auth', router: auth.protectedRouter },
      { path: '/auth', router: organizationOnboarding.router },
    ],
    routers: [
      { path: '/roles', router: roles.router },
      { path: '/masters', router: masters.protectedRouter },
      { path: '/tracking', router: tracking.router },
      { path: '/notifications', router: notifications.router },
      { path: '/payments', router: payments.router },
      { path: '/maintenance', router: maintenance.router },
      { path: '/admin', router: admin.router },
      { path: '/dashboards', router: dashboards.router },
      { path: '/customers/import', router: customers.importRouter },
      { path: '/customers', router: customers.router },
      { path: '/loads', router: loads.protectedRouter },
      { path: '/files', router: storage.router },
    ],
  };
}
