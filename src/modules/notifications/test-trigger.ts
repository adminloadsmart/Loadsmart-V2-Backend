import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { respond } from '../../shared/responses/respond';
import { NotFoundError } from '../../shared/errors';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { NotificationDestinations } from './notifications.interface';
import { NotificationChannelName } from './notifications.types';
import { NOTIFICATION_CATALOG, IN_APP_HIDDEN_TYPES } from './catalog/notification-catalog';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import { NotificationContextOf, NotificationTypeKey } from './notification-triggers';

/**
 * TEMPORARY, non-production test endpoint — POST /v1/notifications/test/trigger-all. Sends every
 * implemented notification type ONCE to the caller only, built from fixed sample data (no real
 * vehicle/load/org record is read or changed). Mounted only when NODE_ENV !== 'production' AND
 * NOTIFICATIONS_TEST_ENDPOINT=true (see composition-root.ts). Delete this file and its mount once
 * notification QA is done.
 *
 * Channels follow the same rules as the real dispatcher (notify-by-type.ts) applied to the caller
 * — email if they have one, SMS only for types with their own template, WhatsApp only with a
 * phone (and opt-in where the type requires it), push only with a registered device — and then
 * go through the normal delivery queue, so whether SMS/WhatsApp/email/push really send depends on
 * the server's MSG91/Firebase config, exactly like production. Org notification preferences, once
 * per org rules, rate limits, reminders and debouncing are deliberately bypassed: the point is to
 * see each message once, on demand.
 */

type SampleContexts = { [K in NotificationTypeKey]?: NotificationContextOf<K> };

const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';

/** Sheet ID per type, for the response. */
const SHEET_IDS: Partial<Record<NotificationTypeKey, string>> = {
  'organization.account_approved': 'LS_N_0001',
  'organization.signup_received': 'LS_N_0002',
  'organization.document_more_info_needed': 'LS_N_0003',
  'organization.account_not_approved': 'LS_N_0004',
  'organization.team_member_invited': 'LS_N_0005',
  'user.access_changed': 'LS_N_0006',
  'organization.master_approval_requested': 'LS_N_0009',
  'organization.master_approvals_waiting': 'LS_N_0009 (collapsed summary)',
  'organization.master_approved': 'LS_N_0010',
  'organization.master_rejected': 'LS_N_0011',
  'vehicle.vahan_unverified': 'LS_N_0012',
  'vehicle.document_expiry': 'LS_N_0047',
  'vehicle.documents_expiring_rollup': 'LS_N_0047 (weekly roll-up)',
  'vehicle.compliance_expired': 'LS_N_0048',
  'driver.licence_expiry': 'LS_N_0049 (expiring)',
  'driver.licence_expired': 'LS_N_0049 (expired)',
  'load.breakdown_reported': 'LS_N_0054',
  'vehicle.back_in_service': 'LS_N_0055',
  'vehicle.service_due_soon': 'LS_N_0056',
  'vehicle.service_overdue': 'LS_N_0057',
  'vehicle.tyre_attention': 'LS_N_0058',
  'vehicle.idle_weekly': 'LS_N_0059',
  'digest.daily_brief': 'LS_N_0060',
};

/** Fixed sample context per implemented type — compile-checked against each type's own context.
 *  `callerId` fills the "who" fields so names resolve to the caller. Placeholder catalog types
 *  with no producer (load.stage_handoff etc.) are deliberately not listed. */
function sampleContexts(callerId: string, today: string): SampleContexts {
  return {
    'organization.account_approved': { orgName: 'Sample Logistics' },
    'organization.signup_received': { orgName: 'Sample Logistics' },
    'organization.document_more_info_needed': {
      orgName: 'Sample Logistics',
      docType: 'GST certificate',
      documentId: SAMPLE_ID,
    },
    'organization.account_not_approved': {
      orgName: 'Sample Logistics',
      reason: 'GSTIN does not match the registered business name',
    },
    'organization.team_member_invited': {
      userId: callerId,
      inviterName: 'Sample Admin',
      orgName: 'Sample Logistics',
      capabilitySummary: 'manage load requisitions and create customers',
    },
    'user.access_changed': {
      userId: callerId,
      adminUserId: callerId,
      baselinePermissions: [],
      adminName: 'Sample Admin',
      orgName: 'Sample Logistics',
      addedCapabilities: 'approve customers',
      removedCapabilities: 'manage load requisitions',
      removedCount: 1,
    },
    'organization.master_approval_requested': {
      kind: 'vehicle',
      recordId: SAMPLE_ID,
      masterValue: 'MH12AB1234',
      createdByUserId: callerId,
      userName: 'Dev Patel',
    },
    'organization.master_approvals_waiting': { userId: callerId, waitingCount: 5 },
    'organization.master_approved': {
      kind: 'loading_point',
      recordId: SAMPLE_ID,
      masterValue: 'Pune Warehouse',
      createdByUserId: callerId,
      approvedByUserId: callerId,
      adminName: 'Sample Admin',
    },
    'organization.master_rejected': {
      kind: 'customer',
      recordId: SAMPLE_ID,
      masterValue: 'Shree Traders',
      createdByUserId: callerId,
      rejectedByUserId: callerId,
      reason: 'GSTIN is invalid',
      adminName: 'Sample Admin',
    },
    'vehicle.vahan_unverified': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      createdByUserId: callerId,
    },
    'vehicle.document_expiry': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      docType: 'Insurance',
      expiryDate: today,
      daysLeft: 7,
      plannedTripCount: 2,
      otherCount: 3,
      runDate: today,
    },
    'vehicle.documents_expiring_rollup': {
      docCount: 3,
      docList:
        'MH12AB1234: Insurance (in 7 days); MH14CD5678: PUC (in 12 days); MH12AB1234: Permit (in 25 days)',
      runDate: today,
    },
    'vehicle.compliance_expired': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      docType: 'Fitness certificate',
      expiryDate: today,
      affectedTripCount: 2,
      runDate: today,
    },
    'driver.licence_expiry': {
      tenantId: SAMPLE_ID,
      driverId: SAMPLE_ID,
      driverName: 'Ramesh Yadav',
      dlNo: 'MH1220110012345',
      expiryDate: today,
      daysLeft: 15,
      tripCount: 2,
      runDate: today,
    },
    'driver.licence_expired': {
      tenantId: SAMPLE_ID,
      driverId: SAMPLE_ID,
      driverName: 'Ramesh Yadav',
      dlNo: 'MH1220110012345',
      expiryDate: today,
      tripCount: 2,
      runDate: today,
      stage: 'initial',
      includeOrgAdmins: false,
    },
    'load.breakdown_reported': {
      issueId: SAMPLE_ID,
      loadId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      driverName: 'Ramesh Yadav',
      driverPhone: '9876500000',
      breakdownType: 'engine failure',
      location: 'Khalapur toll, Mumbai–Pune Expressway',
      reportTime: '10:45',
      destination: 'Pune',
      loadCode: 'LD-0001',
      consignee: 'Shree Traders',
    },
    'vehicle.back_in_service': {
      jobId: SAMPLE_ID,
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      downtimeHours: '18',
      repairCost: '₹12,500',
      availableFrom: today,
      loadCount: 4,
      costViewerIds: [callerId],
    },
    'vehicle.service_due_soon': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      kmRemaining: 1500,
      serviceType: 'preventive',
      serviceDueKm: 120000,
      dailyAvgKm: 250,
      daysRemaining: 6,
      plannedTripCount: 3,
      stage: 'first',
      runDate: today,
    },
    'vehicle.service_overdue': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      kmOverdue: 2300,
      serviceType: 'preventive',
      serviceDueKm: 120000,
      currentOdometer: 122300,
      serviceCost: '₹8,000',
      breakdownCost: '₹45,000',
      escalated: false,
      runDate: today,
    },
    'vehicle.tyre_attention': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      tyres: [
        { tyreId: SAMPLE_ID, position: 'FL', km: 48000, action: 'retread', cpk: '₹0.42' },
        { tyreId: SAMPLE_ID, position: 'R1L', km: 61000, action: 'replacement', cpk: null },
      ],
      fleetCpk: '₹0.38',
      runDate: today,
    },
    'vehicle.idle_weekly': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      idleDays: 6,
      lastTripDate: today,
      fixedCostPerDay: '₹2,000',
      idleCost: '₹12,000',
      otherIdleCount: 2,
      runDate: today,
    },
    'digest.daily_brief': {
      userId: callerId,
      orgName: 'Sample Logistics',
      tripsRunning: 4,
      arrivingToday: '0 (static)',
      delayed: '0 (static)',
      podsPending: 2,
      approvalsPending: 3,
      vehiclesBlocked: 1,
      emptyVehicles: 2,
      idleLocations: 'location unavailable (static)',
      needsAction: 6,
      runDate: today,
    },
  };
}

export interface NotificationsTestDeps {
  notificationsService: NotificationsService;
  authRepository: AuthRepository;
  authService: AuthService;
}

export function createNotificationsTestRoutes(deps: NotificationsTestDeps): Router {
  const router = Router();
  const body = z.object({
    body: z
      .object({ types: z.array(z.string()).optional() })
      .strict()
      .optional(),
  });

  router.post(
    '/trigger-all',
    validate(body),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = requireTenantId(req);
      const caller = await deps.authRepository.findUserById(req.user!.id);
      if (!caller) throw new NotFoundError('User not found');

      const today = new Date().toISOString().slice(0, 10);
      const samples = sampleContexts(caller.id, today);
      const wanted: string[] | undefined = req.body?.types;
      const [session] = await deps.authService.getActiveDeviceTokensForUser(caller.id);

      const results = [];
      for (const [type, context] of Object.entries(samples)) {
        if (wanted && !wanted.includes(type)) continue;
        const definition = (
          NOTIFICATION_CATALOG as Record<string, NotificationTypeDefinition<unknown>>
        )[type];
        const {
          title,
          body: text,
          metadata,
        } = definition.buildContent(context, {
          id: caller.id,
          fullName: caller.fullName,
        });

        // Same channel rules as notify-by-type.ts, applied to the caller only.
        const channels: NotificationChannelName[] = [];
        const destinations: NotificationDestinations = {};
        if (definition.channels.includes('email') && caller.email) {
          channels.push('email');
          destinations.email = caller.email;
        }
        if (
          definition.channels.includes('sms') &&
          definition.templates?.sms &&
          caller.phoneNumber
        ) {
          channels.push('sms');
          destinations.phoneNumber = caller.phoneNumber;
        }
        if (
          definition.channels.includes('whatsapp') &&
          caller.phoneNumber &&
          (!definition.requiresWhatsappOptIn || caller.whatsappOptIn === true)
        ) {
          channels.push('whatsapp');
          destinations.whatsappNumber = caller.phoneNumber;
        }
        if (definition.channels.includes('push') && session?.fcmToken) {
          channels.push('push');
          destinations.pushToken = session.fcmToken;
        }

        const notification = await deps.notificationsService.send(tenantId, {
          recipientUserId: caller.id,
          type,
          title,
          body: text,
          channels,
          destinations,
          metadata: { ...metadata, test: 'true' },
          severity: definition.severity,
        });
        results.push({
          sheetId: SHEET_IDS[type as NotificationTypeKey] ?? null,
          type,
          notificationId: notification.id,
          severity: definition.severity,
          title,
          body: text,
          channelsQueued: channels,
          // inApp:false types are stored but hidden from GET /notifications by design.
          shownInApp: !IN_APP_HIDDEN_TYPES.includes(type),
        });
      }

      respond(res, {
        sent: results.length,
        recipient: { id: caller.id, email: caller.email, phoneNumber: caller.phoneNumber },
        note:
          'Delivery is asynchronous — check GET /v1/notifications/:notificationId for per-channel status. ' +
          'LS_N_0008 (login OTP) is not a stored notification: test it via POST /v1/auth/login/otp/request.',
        results,
      });
    }),
  );

  return router;
}
