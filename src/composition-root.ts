import { Router, RequestHandler } from 'express';
import { DataSource } from 'typeorm';
import { TenancyGateway } from './shared/tenancy/tenancy.gateway';
import { createAuth } from './shared/middleware/auth.middleware';
import { createAudit } from './shared/middleware/audit.middleware';

import { createAuthModule } from './modules/auth';
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
  // JWT's `permissions` claim (see modules/auth/index.ts and modules/roles/index.ts).
  const roles = createRolesModule(dataSource, { auditService: audit.service });

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
  });
  const authMiddleware = createAuth(auth.authRepository);

  // The org onboarding router (GET/POST /auth/organization*) — built here, not alongside
  // `organization` above, since it needs auth.service (createOrganization etc. also mutate the
  // caller's own session on first-time org creation). Mounted at '/auth' below, same URLs as
  // before this was its own router — see modules/organization/organization.routes.ts.
  const organizationOnboarding = createOrganizationOnboardingRoutes(auth.service);

  // Standalone — no cross-module deps of its own. Built before masters: driver.service.ts injects
  // storage.service directly to validate/resolve the driving-licence front/back photos uploaded
  // through the manual-Sarathi-review route (see modules/masters/driver.service.ts).
  const storage = createStorageModule(dataSource);

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
      { path: '/files', router: storage.router },
    ],
  };
}
