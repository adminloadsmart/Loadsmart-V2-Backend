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
 * TEMPORARY, non-production test endpoint — POST /v1/notifications/test/trigger-all. Sends each
 * type in SHEET_IDS ONCE, built from fixed sample data, with SMS/WhatsApp going to
 * TEST_PHONE_NUMBER and email/push/in-app to the caller (no real
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
  'vehicle.document_expiry': 'LS_N_0047',
  'vehicle.compliance_expired': 'LS_N_0048',
  'driver.licence_expiry': 'LS_N_0049 (expiring)',
  'driver.licence_expired': 'LS_N_0049 (expired)',
  'load.breakdown_reported': 'LS_N_0054',
  'vehicle.service_due_soon': 'LS_N_0056',
  'vehicle.service_overdue': 'LS_N_0057',
  'vehicle.tyre_attention': 'LS_N_0058',
};

/** Every SMS/WhatsApp from this endpoint goes here instead of the caller's own number. */
const TEST_PHONE_NUMBER = '6284333505';

/** YYYY-MM-DD, `days` after `today` (also YYYY-MM-DD). */
function addDays(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Fixed sample context per type — compile-checked against each type's own context. Dates are
 *  consistent with the counts (e.g. "expires in 7 days" carries an expiry date 7 days out). */
function sampleContexts(today: string): SampleContexts {
  return {
    'vehicle.document_expiry': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      docType: 'Insurance',
      expiryDate: addDays(today, 7),
      daysLeft: 7,
      plannedTripCount: 2,
      otherCount: 3,
      runDate: today,
    },
    'vehicle.compliance_expired': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      docType: 'Fitness certificate',
      expiryDate: today,
      affectedTripCount: 2,
      nextAffectedTrip: {
        loadId: SAMPLE_ID,
        loadCode: 'LD-4521',
        route: 'Ludhiana to Bhiwandi',
        pickupDate: addDays(today, 1),
        transporterName: 'Sohal Roadlines',
      },
      runDate: today,
    },
    'driver.licence_expiry': {
      tenantId: SAMPLE_ID,
      driverId: SAMPLE_ID,
      driverName: 'Ramesh Yadav',
      dlNo: 'MH1220110012345',
      expiryDate: addDays(today, 15),
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
        {
          tyreId: SAMPLE_ID,
          position: 'FL',
          km: 48000,
          action: 'retread',
          cpk: '₹0.42',
          treadMm: 4.6,
        },
        {
          tyreId: SAMPLE_ID,
          position: 'R1L',
          km: 61000,
          action: 'replacement',
          cpk: null,
          treadMm: 2.1,
        },
      ],
      fleetCpk: '₹0.38',
      runDate: today,
    },
  };
}

/** Sheet ID for every type /in-app-all can create, for the response. */
const ALL_SHEET_IDS: Partial<Record<NotificationTypeKey, string>> = {
  ...SHEET_IDS,
  'organization.account_approved': 'LS_N_0001',
  'organization.signup_received': 'LS_N_0002',
  'organization.document_more_info_needed': 'LS_N_0003',
  'organization.account_not_approved': 'LS_N_0004',
  'organization.team_member_invited': 'LS_N_0005',
  'user.access_changed': 'LS_N_0006',
  'organization.master_approval_requested': 'LS_N_0009',
  'organization.master_approvals_waiting': 'LS_N_0009 (collapsed)',
  'organization.master_approved': 'LS_N_0010',
  'organization.master_rejected': 'LS_N_0011',
  'vehicle.vahan_unverified': 'LS_N_0012',
  'vehicle.documents_expiring_rollup': 'LS_N_0047 (weekly roll-up)',
  'vehicle.back_in_service': 'LS_N_0055',
  'vehicle.idle_weekly': 'LS_N_0059',
  'digest.daily_brief': 'LS_N_0060',
  'load.stage_handoff': 'Trip stage handoff',
  'load.eway_bill_expiry': 'E-way bill expiry',
  'load.pod_uploaded': 'POD uploaded',
  'load.advance_due': 'Advance due',
};

/** A sample context for EVERY catalog type — the full mapped type makes a newly added catalog
 *  type a compile error here until it gets a sample, so /in-app-all never silently skips one.
 *  `callerId` stands in for every "this user" id so per-recipient copy (e.g. LS_N_0055's repair
 *  cost) renders the way the caller would really see it. */
function allSampleContexts(
  today: string,
  callerId: string,
): { [K in NotificationTypeKey]: NotificationContextOf<K> } {
  const driverLink = { driverId: SAMPLE_ID, driverName: 'Ramesh Yadav', phoneNumber: '9876500000' };
  const sampleLoad = {
    loadId: SAMPLE_ID,
    loadCode: 'LD-4521',
    vehicleNo: 'HR55QL8450',
    route: 'Ludhiana to Bhiwandi',
    transporterName: 'Sohal Roadlines',
    consignee: 'Sundram Buildwell',
  };
  return {
    ...(sampleContexts(today) as Required<SampleContexts>),
    'organization.account_approved': { orgName: 'Acme Logistics' },
    'organization.signup_received': { orgName: 'Acme Logistics' },
    'organization.document_more_info_needed': {
      orgName: 'Acme Logistics',
      docType: 'GST certificate',
      documentId: SAMPLE_ID,
    },
    'organization.account_not_approved': {
      orgName: 'Acme Logistics',
      reason: 'The GST number could not be verified',
    },
    'organization.team_member_invited': {
      userId: callerId,
      inviterName: 'Priya Sharma',
      orgName: 'Acme Logistics',
      capabilitySummary: 'create loads and manage drivers',
    },
    'user.access_changed': {
      userId: callerId,
      adminUserId: SAMPLE_ID,
      baselinePermissions: [],
      adminName: 'Priya Sharma',
      orgName: 'Acme Logistics',
      addedCapabilities: 'approve masters',
      removedCapabilities: 'view payments',
      removedCount: 1,
    },
    'organization.master_approval_requested': {
      kind: 'vehicle',
      recordId: SAMPLE_ID,
      masterValue: 'MH12AB1234',
      createdByUserId: SAMPLE_ID,
      userName: 'Amit Patil',
    },
    'organization.master_approvals_waiting': { userId: callerId, waitingCount: 5 },
    'organization.master_approved': {
      kind: 'driver',
      recordId: SAMPLE_ID,
      masterValue: 'Ramesh Yadav',
      createdByUserId: callerId,
      approvedByUserId: SAMPLE_ID,
      adminName: 'Priya Sharma',
    },
    'organization.master_rejected': {
      kind: 'customer',
      recordId: SAMPLE_ID,
      masterValue: 'Shree Traders',
      createdByUserId: callerId,
      rejectedByUserId: SAMPLE_ID,
      reason: 'Duplicate of an existing customer',
      adminName: 'Priya Sharma',
    },
    'vehicle.vahan_unverified': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      createdByUserId: callerId,
    },
    'vehicle.documents_expiring_rollup': {
      docCount: 4,
      docList: 'MH12AB1234 Insurance (7 days), MH14CD5678 PUC (12 days)',
      runDate: today,
    },
    'vehicle.back_in_service': {
      jobId: SAMPLE_ID,
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      downtimeHours: '18',
      repairCost: '₹12,500',
      availableFrom: '14:00 today',
      loadCount: 2,
      costViewerIds: [callerId],
    },
    'vehicle.idle_weekly': {
      vehicleId: SAMPLE_ID,
      vehicleNo: 'MH12AB1234',
      idleDays: 6,
      lastTripDate: addDays(today, -6),
      fixedCostPerDay: '₹2,000',
      idleCost: '₹12,000',
      otherIdleCount: 2,
      runDate: today,
    },
    'digest.daily_brief': {
      userId: callerId,
      orgName: 'Acme Logistics',
      tripsRunning: 12,
      arrivingToday: '4',
      delayed: '1',
      podsPending: 3,
      approvalsPending: 2,
      vehiclesBlocked: 1,
      emptyVehicles: 5,
      idleLocations: 'Bhiwandi, Pune',
      needsAction: 6,
      runDate: today,
    },
    'load.stage_handoff': {
      ...sampleLoad,
      stage: 'reached_delivery_point',
      at: new Date().toISOString(),
    },
    'load.eway_bill_expiry': {
      ...sampleLoad,
      generatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ewayBillNumber: 'EWB-910291',
    },
    'load.pod_uploaded': {
      ...sampleLoad,
      uploadedAt: new Date().toISOString(),
      receiverName: 'Suresh Kumar',
      quantityReceived: '31.50',
      tonnesShort: '0.50',
      shortageOrDamage: 'shortage',
    },
    'load.advance_due': {
      ...sampleLoad,
      advancePercentage: '70.00',
      amount: '₹41,797',
      bankName: 'ICICI Bank',
      accountLast4: '4091',
    },
    'driver.link_requested': driverLink,
    'driver.link_accepted': driverLink,
    'driver.account_deleted': driverLink,
    'load.trip_delay_exception': {},
    'tracking.geofence_breach': {},
    'payments.due_settlement': {},
    'maintenance.compliance_due': {},
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
      const samples = sampleContexts(today);
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
          highlights,
        } = definition.buildContent(context, {
          id: caller.id,
          fullName: caller.fullName,
        });

        // Same channel rules as notify-by-type.ts — SMS/WhatsApp to TEST_PHONE_NUMBER, the rest to
        // the caller.
        const channels: NotificationChannelName[] = [];
        const destinations: NotificationDestinations = {};
        if (definition.channels.includes('email') && caller.email) {
          channels.push('email');
          destinations.email = caller.email;
        }
        if (definition.channels.includes('sms') && definition.templates?.sms) {
          channels.push('sms');
          destinations.phoneNumber = TEST_PHONE_NUMBER;
        }
        if (definition.channels.includes('whatsapp')) {
          channels.push('whatsapp');
          destinations.whatsappNumber = TEST_PHONE_NUMBER;
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
          metadata: { ...metadata, ...(highlights?.length ? { highlights } : {}), test: 'true' },
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
        recipient: { id: caller.id, email: caller.email, phoneNumber: TEST_PHONE_NUMBER },
        note:
          'Delivery is asynchronous — check GET /v1/notifications/:notificationId for per-channel status. ' +
          'LS_N_0008 (login OTP) is not a stored notification: test it via POST /v1/auth/login/otp/request.',
        results,
      });
    }),
  );

  /**
   * POST /v1/notifications/test/in-app-all — one IN-APP-ONLY notification per catalog type, to
   * the caller, for testing the inbox UI in one go: no SMS/WhatsApp/email/push is sent (channels
   * is []). Types hidden from the inbox (inApp: false) are skipped unless includeHidden is true —
   * they'd be stored but never visible in GET /notifications anyway.
   */
  const inAppBody = z.object({
    body: z
      .object({
        types: z.array(z.string()).optional(),
        includeHidden: z.boolean().optional(),
      })
      .strict()
      .optional(),
  });

  router.post(
    '/in-app-all',
    validate(inAppBody),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = requireTenantId(req);
      const caller = await deps.authRepository.findUserById(req.user!.id);
      if (!caller) throw new NotFoundError('User not found');

      const today = new Date().toISOString().slice(0, 10);
      const wanted: string[] | undefined = req.body?.types;
      const includeHidden: boolean = req.body?.includeHidden ?? false;

      const results = [];
      for (const [type, context] of Object.entries(allSampleContexts(today, caller.id))) {
        if (wanted && !wanted.includes(type)) continue;
        const shownInApp = !IN_APP_HIDDEN_TYPES.includes(type);
        if (!shownInApp && !includeHidden) continue;

        const definition = (
          NOTIFICATION_CATALOG as Record<string, NotificationTypeDefinition<unknown>>
        )[type];
        const {
          title,
          body: text,
          metadata,
          highlights,
        } = definition.buildContent(context, { id: caller.id, fullName: caller.fullName });

        const notification = await deps.notificationsService.send(tenantId, {
          recipientUserId: caller.id,
          type,
          title,
          body: text,
          channels: [],
          metadata: { ...metadata, ...(highlights?.length ? { highlights } : {}), test: 'true' },
          severity: definition.severity,
        });
        results.push({
          sheetId: ALL_SHEET_IDS[type as NotificationTypeKey] ?? null,
          type,
          notificationId: notification.id,
          severity: definition.severity,
          title,
          body: text,
          ctaPath: metadata?.cta_path ?? null,
          shownInApp,
        });
      }

      respond(res, {
        created: results.length,
        recipient: { id: caller.id, fullName: caller.fullName },
        note: 'In-app only — nothing was sent over SMS/WhatsApp/email/push. View them via GET /v1/notifications.',
        results,
      });
    }),
  );

  return router;
}
