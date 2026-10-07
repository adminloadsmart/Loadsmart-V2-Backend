import { Router, RequestHandler } from 'express';
import { DataSource } from 'typeorm';
import { Worker } from 'bullmq';
import { TenancyGateway } from './shared/tenancy/tenancy.gateway';
import { createAuth } from './shared/middleware/auth.middleware';
import { createAudit } from './shared/middleware/audit.middleware';
import { Msg91Client } from './adapters/msg91.client';
import { OtpService } from './shared/services/otp.service';

import { createAuthModule } from './modules/auth';
import { AuthRepository } from './modules/auth/auth.repository';
import {
  createOrganizationModule,
  createOrganizationOnboardingRoutes,
} from './modules/organization';
import { createRolesModule } from './modules/roles';
import {
  createDriverModule,
  createDriverAuthModule,
  createDriverPortalModule,
} from './modules/driver';
import { createMastersModule } from './modules/masters';
import { createTrackingModule } from './modules/tracking';
import { createNotificationsModule } from './modules/notifications';
import { createNotificationsTestRoutes } from './modules/notifications/test-trigger';
import { env } from './config/env';
import { createNotifyByType } from './modules/notifications/notify-by-type';
import { createNotificationTriggerWorker } from './modules/notifications/workers/notification-trigger.worker';
import {
  createAccessChangeRecorder,
  createAccessChangeResolver,
} from './modules/notifications/access-change';
import {
  createNotificationScheduleWorker,
  createVehicleDocumentAlerts,
  NOTIFICATION_SCHEDULES_QUEUE,
  scheduleVehicleDocumentChecks,
} from './modules/notifications/vehicle-document-alerts';
import {
  createBreakdownNotifier,
  createBreakdownResolver,
} from './modules/notifications/breakdown-alerts';
import { createBackInServiceResolver } from './modules/notifications/back-in-service';
import { createServiceAlerts } from './modules/notifications/service-alerts';
import { createDigests, digestJobs, scheduleDigests } from './modules/notifications/digests';
import { createJobQueue } from './jobs/queue-registry';
import {
  createMasterApprovalNotifier,
  createMasterApprovalResolvers,
  createVahanStillUnverifiedCheck,
} from './modules/notifications/master-approvals';
import { organizationDisplayName } from './modules/organization/organization.constants';
import { createPaymentsModule } from './modules/payments';
import { createMaintenanceModule } from './modules/maintenance';
import { createAuditModule } from './modules/audit';
import { createAdminModule } from './modules/admin';
import { createDashboardsModule } from './modules/dashboards';
import { createCustomersModule } from './modules/customers';
import { createStorageModule } from './modules/storage';
import { createLoadsModule } from './modules/loads';
import { createAnalyticsModule } from './modules/analytics';
import { createFleetAnalyticsModule } from './modules/analytics/fleet-analytics';
import { createDriverAnalyticsModule } from './modules/analytics/driver-analytics';

import { NotificationsGatewayLocal as MaintenanceNotificationsGatewayLocal } from './modules/maintenance/gateways/notifications.gateway.local';
import { FleetGatewayLocal as MaintenanceFleetGatewayLocal } from './modules/maintenance/gateways/fleet.gateway.local';
import { StorageGatewayLocal as MaintenanceStorageGatewayLocal } from './modules/maintenance/gateways/storage.gateway.local';

export interface Container {
  tenancyGateway: TenancyGateway;
  authMiddleware: RequestHandler;
  auditMiddleware: RequestHandler;
  publicRouters: { path: string; router: Router }[];
  // Authenticated but not yet tenant-scoped — routes that manage tenant existence itself
  // (or never needed a tenant at all) can't sit behind createTenantScope. See app.ts.
  authenticatedRouters: { path: string; router: Router }[];
  routers: { path: string; router: Router }[];
  // Driver-app routers — mounted in app.ts AHEAD of the staff authMiddleware entirely, not in
  // authenticatedRouters/routers above. A driver's bearer token has purpose 'driver-access',
  // which the staff authMiddleware (createAuth) hard-rejects — each router here applies its own
  // auth (createDriverAuth) where it needs one instead. The OTP handshake and /refresh stay
  // fully public. See docs/driver-auth.md.
  driverRouters: { path: string; router: Router }[];
  // In-process background workers (currently just notifications' BullMQ dispatch worker) —
  // server.ts closes each of these on SIGTERM/SIGINT before the HTTP server, so an in-flight job
  // finishes instead of being killed mid-dispatch on a pm2 restart.
  backgroundWorkers: Worker[];
}

export function buildContainer(dataSource: DataSource): Container {
  // Standalone — no cross-module deps. Built before roles: role.service.ts needs auditService
  // injected to log role/permission changes with real old/new data.
  const audit = createAuditModule(dataSource);
  const auditMiddleware = createAudit(audit.service);

  // Producer — no cross-module deps of its own beyond dataSource, so it can be built first: roles
  // (LS_N_0006), auth (LS_N_0002/0005) and admin (LS_N_0001/0003/0004) enqueue notifications
  // through its `triggers`; notifyByType below needs its service.
  const notifications = createNotificationsModule(dataSource);
  // LS_N_0009/0010 — handed to the masters, driver and customers modules (see
  // modules/notifications/master-approvals.ts).
  const masterApprovalNotifier = createMasterApprovalNotifier(notifications.triggers);

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
    // LS_N_0006 "your access changed" — see modules/notifications/access-change.ts.
    onCapabilitiesChanged: createAccessChangeRecorder(notifications.triggers),
  });

  // Standalone — built before auth because the post-submission organization photo endpoint
  // validates an already-confirmed tenant-owned upload through storage.service.
  const storage = createStorageModule(dataSource);

  // No cross-module deps of its own — owns the organization/organization-document/referral-code
  // schema. Built before auth: auth.service.ts orchestrates org onboarding on top of these
  // services directly (see modules/auth/index.ts), the same "read another module's service
  // directly, no gateway" pattern modules/admin/ already used for these when they lived in auth.
  const organization = createOrganizationModule(dataSource);

  // One Msg91Client/OtpService instance for the whole app — every OTP-based login flow (staff
  // signup/login here, driver login below) shares the same Redis-backed cooldown/attempt
  // tracking and MSG91 wrapper rather than each module standing up its own. See
  // shared/services/otp.service.ts.
  const msg91Client = new Msg91Client();
  const otpService = new OtpService(msg91Client);

  const auth = createAuthModule(dataSource, {
    auditService: audit.service,
    roleService: roles.service,
    organizationService: organization.organizationService,
    organizationDocumentService: organization.organizationDocumentService,
    organizationOnboardingService: organization.organizationOnboardingService,
    organizationJourneyStageService: organization.organizationJourneyStageService,
    referralCodeService: organization.referralCodeService,
    storageService: storage.service,
    otpService,
    notificationTriggers: notifications.triggers,
  });
  const authMiddleware = createAuth(auth.authRepository);

  // The org onboarding router (GET/POST /auth/organization*) — built here, not alongside
  // `organization` above, since it needs auth.service (createOrganization etc. also mutate the
  // caller's own session on first-time org creation). Mounted at '/auth' below, same URLs as
  // before this was its own router — see modules/organization/organization.routes.ts.
  const organizationOnboarding = createOrganizationOnboardingRoutes(auth.service);

  // The one dispatcher every notification trigger site below calls against a domain catalog (see
  // modules/notifications/catalog/*) — currently just vehicle compliance (WhatsApp/push); the
  // masters "approval requested" catalog entry is on hold until an email provider exists. Built
  // once here so masters can take it as a plain constructor dependency, no gateway needed (same
  // "consumer takes producer service directly" pattern used throughout this file).
  const notifyByType = createNotifyByType({
    notificationsService: notifications.service,
    authRepository: auth.authRepository,
    authService: auth.service,
    notificationPreferencesRepository: notifications.notificationPreferencesRepository,
    notificationTriggers: notifications.triggers,
  });

  // Built before masters: driver is its own top-level module now (promoted out of masters/ — see
  // docs/driver-auth.md), and fleetDriverLinkService (inside masters) needs driverRepository to
  // validate a link's driverId. masters.routes.ts still composes driver's staff router into the
  // same /v1/masters/drivers/... URLs as before, via deps.driverController below.
  const driver = createDriverModule(dataSource, {
    auditService: audit.service,
    storageService: storage.service,
    organizationService: organization.organizationService,
    masterApprovalNotifier,
  });

  // The driver-app auth/session layer — a separate identity domain from auth.users/roles (see
  // docs/driver-auth.md), sharing driver's own driverRepository, organization's
  // organizationService (org-active login check, same as auth.service.ts's), and the same
  // otpService staff signup/login already uses.
  const driverAuth = createDriverAuthModule(dataSource, {
    driverRepository: driver.driverRepository,
    organizationService: organization.organizationService,
    otpService,
  });

  // Reference data other modules read from.
  const masters = createMastersModule(dataSource, {
    auditService: audit.service,
    storageService: storage.service,
    driverRepository: driver.driverRepository,
    driverController: driver.driverController,
    masterApprovalNotifier,
  });

  // Producers with no cross-module deps of their own.
  const tracking = createTrackingModule(dataSource);
  const payments = createPaymentsModule(dataSource);

  // Consumers — each wired to a local gateway wrapping the producer(s) it needs. Maintenance
  // writes to vehicles through masters' vehicleService (the breakdown ⇄ dispatch hold) and reads
  // VehicleEntity/LoadEntity directly, same as dashboards.
  const maintenance = createMaintenanceModule(dataSource, {
    notificationsGateway: new MaintenanceNotificationsGatewayLocal(
      notifications.service,
      notifications.triggers,
    ),
    fleetGateway: new MaintenanceFleetGatewayLocal(masters.vehicleService),
    storageGateway: new MaintenanceStorageGatewayLocal(storage.service),
    auditService: audit.service,
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
    storageService: storage.service,
    dataSource,
    notificationTriggers: notifications.triggers,
  });

  // Runs notifyByType for jobs queued via notifications.triggers (LS_N_0001–0006 and future
  // event-driven notifications), scheduling one-shot reminders and batching debounced bursts —
  // built here, after admin, since notifyByType needs auth and the relevance checks / context
  // resolvers read other modules' state. See modules/notifications/notification-triggers.ts.
  const masterApprovalResolvers = createMasterApprovalResolvers({
    dataSource,
    getUserFullName: async (userId) =>
      (await auth.authRepository.findUserById(userId))?.fullName ?? null,
    getUserRoleName: async (userId) =>
      (await auth.authRepository.findUserById(userId))?.role.name ?? null,
    getEffectivePermissions: (userId) => roles.service.getEffectivePermissions(userId),
  });
  // LS_N_0047/0048 — the daily 9:00 IST vehicle-document check and the Monday roll-up (see
  // modules/notifications/vehicle-document-alerts.ts). Registering the schedules is idempotent;
  // a failure here is logged, never fatal to boot.
  const vehicleDocumentAlerts = createVehicleDocumentAlerts(dataSource, notifications.triggers);
  // LS_N_0056/0057 — service due soon / overdue, swept in the same daily 9:00 IST job.
  const serviceAlerts = createServiceAlerts(dataSource, notifications.triggers);
  // LS_N_0059/0060 — weekly idle-vehicle roll-up and the daily morning brief (digests.ts).
  const digests = createDigests(dataSource, notifications.triggers);
  const notificationScheduleWorker = createNotificationScheduleWorker(
    vehicleDocumentAlerts,
    serviceAlerts,
    digestJobs(digests),
  );
  scheduleVehicleDocumentChecks(createJobQueue(NOTIFICATION_SCHEDULES_QUEUE)).catch((error) =>
    console.error('Failed to register vehicle document check schedules', error),
  );
  scheduleDigests(createJobQueue(NOTIFICATION_SCHEDULES_QUEUE)).catch((error) =>
    console.error('Failed to register digest schedules', error),
  );

  const notificationTriggerWorker = createNotificationTriggerWorker(
    notifyByType,
    notifications.triggersQueue,
    {
      'organization.document_more_info_needed': (tenantId, context) =>
        admin.service.isDocumentReuploadPending(tenantId, context.documentId),
      // LS_N_0049 — one expiring alert per driver per day; expired ladder steps once each, and
      // only while the licence is still expired.
      'driver.licence_expiry': vehicleDocumentAlerts.driverExpiringNotSentToday,
      'driver.licence_expired': vehicleDocumentAlerts.driverExpiredStillRelevant,
      // LS_N_0047/0048 — at most one per vehicle per day, even if a check is re-run.
      'vehicle.document_expiry':
        vehicleDocumentAlerts.notAlreadySentToday('vehicle.document_expiry'),
      'vehicle.compliance_expired': vehicleDocumentAlerts.notAlreadySentToday(
        'vehicle.compliance_expired',
      ),
      // LS_N_0012 only if the vehicle is still unverified when the 24h retry window ends.
      'vehicle.vahan_unverified': createVahanStillUnverifiedCheck(dataSource),
      // LS_N_0056/0057 — each due-soon stage once per service cycle; overdue once per run day.
      'vehicle.service_due_soon': serviceAlerts.dueSoonNotAlreadySent,
      'vehicle.service_overdue': serviceAlerts.overdueNotAlreadySentToday,
      // LS_N_0059/0060 — a digest is never sent twice for the same run day.
      'vehicle.idle_weekly': digests.idleWeeklyNotSent,
      'digest.daily_brief': digests.dailyBriefNotSent,
      // LS_N_0005's 24h reminder only while the invitee still hasn't signed in.
      'organization.team_member_invited': async (_tenantId, context) =>
        !(await auth.authRepository.hasEverSignedIn(context.userId)),
    },
    {
      'organization.master_approval_requested': masterApprovalResolvers.requested,
      'organization.master_approvals_waiting': masterApprovalResolvers.waiting,
      'organization.master_approved': masterApprovalResolvers.approved,
      'organization.master_rejected': masterApprovalResolvers.rejected,
      'user.access_changed': createAccessChangeResolver({
        getEffectivePermissions: (userId) => roles.service.getEffectivePermissions(userId),
        describePermissions: (keys) => roles.service.describePermissions(keys),
        getUserFullName: async (userId) =>
          (await auth.authRepository.findUserById(userId))?.fullName ?? null,
        getOrganizationName: async (tenantId) =>
          organizationDisplayName(
            await organization.organizationService.getOrganizationStatus(tenantId),
          ),
      }),
      // LS_N_0054 — reads the breakdown report and its trip at send time.
      'load.breakdown_reported': createBreakdownResolver(dataSource),
      // LS_N_0055 — reads the closed workshop visit; cost shown only to cost viewers.
      'vehicle.back_in_service': createBackInServiceResolver({
        dataSource,
        listUsersWithPermission: (tenantId, permission) =>
          auth.authRepository.listUsersWithPermission(tenantId, permission),
      }),
    },
  );

  // No cross-module deps of its own — built before dashboards, which reads its service directly
  // (Settings → Approvals aggregates pending customers alongside pending vehicles/drivers).
  const customers = createCustomersModule(dataSource, audit.service, masterApprovalNotifier);

  // Built after customers/masters/storage — the Load module reads customers.service
  // (unloading-point validation) and masters' vehicle/transporter/truckType/loadingPoint/
  // product services (capacity matching + master-record validation) and storage.service
  // (invoice/e-way-bill/E-LR/E-POD uploads) directly, no gateway — same "consumer takes producer
  // services as direct constructor args" pattern dashboards uses below.
  const loads = createLoadsModule(dataSource, {
    auditService: audit.service,
    authService: auth.service,
    storageService: storage.service,
    customerService: customers.service,
    vehicleService: masters.vehicleService,
    transporterService: masters.transporterService,
    truckTypeService: masters.truckTypeService,
    loadingPointService: masters.loadingPointService,
    productService: masters.productService,
    // Push-notification payoff for driver_sessions.fcm_token — see docs/driver-auth.md.
    driverAuthService: driverAuth.service,
    notificationsService: notifications.service,
    // LS_N_0054 — a driver-reported breakdown alerts maintenance holders and org admins.
    onBreakdownReported: createBreakdownNotifier(notifications.triggers),
  });

  // Driver-app self-service ("my loads") — built here, not alongside driverAuth above, since it
  // needs loads.loadService, which doesn't exist until this point. See docs/driver-auth.md.
  const driverPortal = createDriverPortalModule({
    driverRepository: driver.driverRepository,
    driverService: driver.driverService,
    loadService: loads.loadService,
    storageService: storage.service,
  });

  // Last — reads other modules' services directly, and (via DashboardsRepository) LoadEntity
  // directly, same as the analytics/* modules below.
  const dashboards = createDashboardsModule(dataSource, {
    vehicleService: masters.vehicleService,
    driverService: driver.driverService,
    customerService: customers.service,
  });
  const analytics = createAnalyticsModule(dataSource);
  const fleetAnalytics = createFleetAnalyticsModule(dataSource);
  const driverAnalytics = createDriverAnalyticsModule(dataSource);

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
      // TEMPORARY QA endpoint — mounted ahead of the main router; non-production + flag only.
      ...(env.notificationsTestEndpoint
        ? [
            {
              path: '/notifications/test',
              router: createNotificationsTestRoutes({
                notificationsService: notifications.service,
                authRepository: auth.authRepository,
                authService: auth.service,
              }),
            },
          ]
        : []),
      { path: '/notifications', router: notifications.router },
      { path: '/payments', router: payments.router },
      { path: '/maintenance', router: maintenance.router },
      { path: '/admin', router: admin.router },
      { path: '/dashboards', router: dashboards.router },
      { path: '/analytics', router: analytics.router },
      { path: '/fleet-analytics', router: fleetAnalytics.router },
      { path: '/driver-analytics', router: driverAnalytics.router },
      { path: '/customers', router: customers.router },
      { path: '/loads', router: loads.protectedRouter },
      { path: '/files', router: storage.router },
    ],
    driverRouters: [
      { path: '/driver-auth', router: driverAuth.publicRouter },
      { path: '/driver-auth', router: driverAuth.protectedRouter },
      { path: '/driver-portal', router: driverPortal.router },
    ],
    backgroundWorkers: [
      notifications.worker,
      notificationTriggerWorker,
      notificationScheduleWorker,
    ],
  };
}
