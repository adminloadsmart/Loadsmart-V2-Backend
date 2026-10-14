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
        { tyreId: SAMPLE_ID, position: 'FL', km: 48000, action: 'retread', cpk: '₹0.42' },
        { tyreId: SAMPLE_ID, position: 'R1L', km: 61000, action: 'replacement', cpk: null },
      ],
      fleetCpk: '₹0.38',
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
        recipient: { id: caller.id, email: caller.email, phoneNumber: TEST_PHONE_NUMBER },
        note:
          'Delivery is asynchronous — check GET /v1/notifications/:notificationId for per-channel status. ' +
          'LS_N_0008 (login OTP) is not a stored notification: test it via POST /v1/auth/login/otp/request.',
        results,
      });
    }),
  );

  return router;
}
