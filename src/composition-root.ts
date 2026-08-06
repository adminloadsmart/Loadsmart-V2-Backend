import { Router, RequestHandler } from 'express';
import { DataSource } from 'typeorm';
import { TenancyGateway } from './shared/tenancy/tenancy.gateway';
import { createAuth } from './shared/middleware/auth.middleware';
import { createAudit } from './shared/middleware/audit.middleware';

import { createAuthModule } from './modules/auth';
import { createRolesModule } from './modules/roles';
import { createMastersModule } from './modules/masters';
import { createTrackingModule } from './modules/tracking';
import { createNotificationsModule } from './modules/notifications';
import { createPaymentsModule } from './modules/payments';
import { createMaintenanceModule } from './modules/maintenance';
import { createAuditModule } from './modules/audit';
import { createAdminModule } from './modules/admin';
import { createDashboardsModule } from './modules/dashboards';

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

  const auth = createAuthModule(dataSource, { auditService: audit.service, roleService: roles.service });
  const authMiddleware = createAuth(auth.authRepository);

  // Reference data other modules read from — no cross-module deps of its own.
  const masters = createMastersModule(dataSource);

  // Producers first — no cross-module deps of their own.
  const tracking = createTrackingModule(dataSource);
  const notifications = createNotificationsModule(dataSource);
  const payments = createPaymentsModule(dataSource);

  // Consumers — each wired to a local gateway wrapping the producer(s) it needs.
  const maintenance = createMaintenanceModule(dataSource, {
    notificationsGateway: new MaintenanceNotificationsGatewayLocal(notifications.service),
  });

  // Reads auth's organizationService/organizationDocumentService and authService directly —
  // cross-tenant ops, not a producer/consumer integration, so no gateway wrapper (see admin/index.ts).
  const admin = createAdminModule({
    organizationService: auth.organizationService,
    organizationDocumentService: auth.organizationDocumentService,
    authService: auth.service,
  });

  // Last — reads other modules' services directly (none wired yet).
  const dashboards = createDashboardsModule();

  return {
    tenancyGateway: auth.tenancyGateway,
    authMiddleware,
    auditMiddleware,
    publicRouters: [
      { path: '/auth', router: auth.publicRouter },
    ],
    authenticatedRouters: [
      { path: '/auth', router: auth.protectedRouter },
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
    ],
  };
}
