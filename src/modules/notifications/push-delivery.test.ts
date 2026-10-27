import { describe, expect, it, vi } from 'vitest';
import type { AuthRepository } from '../auth/auth.repository';
import type { AuthService } from '../auth/auth.service';
import type { UserEntity } from '../auth/entities/user.entity';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationPreferencesRepository } from './notification-preferences.repository';
import type { CreateNotificationInput, NotificationTypeKey } from './notifications.interface';
import type { NotificationsService } from './notifications.service';
import { createNotifyByType } from './notify-by-type';
import { allSampleContexts } from './test-trigger';

vi.mock('../../db/redis', () => ({
  redisManager: { incrInFixedWindow: vi.fn(async () => 1) },
}));

const TENANT_ID = 'tenant-1';
const FCM_TOKEN = 'fcm-token-of-latest-device';

/** The sheet's push notifications — every one must queue a push delivery with the device token. */
const PUSH_TYPES: [sheetId: string, type: NotificationTypeKey][] = [
  ['LS_N_0009', 'organization.master_approval_requested'],
  ['LS_N_0011', 'organization.master_rejected'],
  ['LS_N_0012', 'vehicle.vahan_unverified'],
  ['LS_N_0016', 'load.vehicle_assigned'],
  ['LS_N_0017', 'load.assignment_compliance_failed'],
  ['LS_N_0021', 'load.vehicle_not_reported'],
  ['LS_N_0022', 'load.vehicle_reached_pickup'],
  ['LS_N_0023', 'load.detention_at_loading'],
  ['LS_N_0025', 'load.eway_bill_expiry'],
  ['LS_N_0027', 'load.vehicle_halted'],
  ['LS_N_0028', 'load.route_deviation'],
  ['LS_N_0029', 'load.tracking_signal_lost'],
  ['LS_N_0030', 'load.delivery_late'],
  ['LS_N_0031', 'load.vehicle_reached_drop'],
  ['LS_N_0032', 'load.detention_at_unloading'],
  ['LS_N_0034', 'load.shortage_recorded'],
  ['LS_N_0037', 'load.driver_problem_reported'],
  ['LS_N_0038', 'load.pod_uploaded'],
  ['LS_N_0039', 'load.pod_pending'],
  ['LS_N_0040', 'load.pod_rejected'],
  ['LS_N_0048', 'vehicle.compliance_expired'],
  ['LS_N_0049 (expiring)', 'driver.licence_expiry'],
  ['LS_N_0049 (expired)', 'driver.licence_expired'],
  ['LS_N_0050', 'load.licence_mismatch'],
  ['LS_N_0054', 'load.breakdown_reported'],
  ['LS_N_0057', 'vehicle.service_overdue'],
];

const recipient = {
  id: 'recipient-1',
  tenantId: TENANT_ID,
  fullName: 'Asha Verma',
  email: 'asha@example.com',
  phoneNumber: '9876543210',
  whatsappOptIn: true,
  role: { name: 'org_admin' },
} as unknown as UserEntity;

function setup() {
  const sent: CreateNotificationInput[] = [];
  const notificationsService = {
    hasNotificationOfType: vi.fn(async () => false),
    send: vi.fn(async (_tenantId: string, input: CreateNotificationInput) => {
      sent.push(input);
    }),
  } as unknown as NotificationsService;
  const authRepository = {
    listUsersByRole: vi.fn(async () => [recipient]),
    // A permission holder who isn't an org admin — some types (e.g. LS_N_0057) keep org admins out
    // until they escalate.
    listUsersWithPermission: vi.fn(async () => [{ ...recipient, role: { name: 'dispatcher' } }]),
    findUserById: vi.fn(async () => recipient),
  } as unknown as AuthRepository;
  const authService = {
    getActiveDeviceTokensForUser: vi.fn(async () => [{ fcmToken: FCM_TOKEN }]),
  } as unknown as AuthService;
  // No saved org/user preference → each type's defaultChannels apply.
  const notificationPreferencesRepository = {
    findTypeByKey: vi.fn(async () => ({ id: 'type-1' })),
    findByTenantAndTypeId: vi.fn(async () => null),
    listUserPreferencesForType: vi.fn(async () => []),
    findQuietHours: vi.fn(async () => null),
  } as unknown as NotificationPreferencesRepository;
  const notifyByType = createNotifyByType({
    notificationsService,
    authRepository,
    authService,
    notificationPreferencesRepository,
  });
  return { notifyByType, sent };
}

describe('Push channel — every push notification on the sheet queues a push delivery', () => {
  const samples = allSampleContexts('2026-10-27', 'caller-1');

  it.each(PUSH_TYPES)('%s %s', async (_sheetId, type) => {
    const { notifyByType, sent } = setup();

    await notifyByType(NOTIFICATION_CATALOG, type, TENANT_ID, samples[type] as never);

    const toRecipient = sent.filter((input) => input.recipientUserId === recipient.id);
    expect(toRecipient.length).toBeGreaterThan(0);
    for (const input of toRecipient) {
      expect(input.channels).toContain('push');
      expect(input.destinations?.pushToken).toBe(FCM_TOKEN);
    }
  });
});
