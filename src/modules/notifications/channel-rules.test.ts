import { describe, expect, it, vi } from 'vitest';
import type { AuthRepository } from '../auth/auth.repository';
import type { AuthService } from '../auth/auth.service';
import type { UserEntity } from '../auth/entities/user.entity';
import type { LoadChannelFacts } from '../messaging/load-channel-facts';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationPreferencesRepository } from './notification-preferences.repository';
import type {
  CreateNotificationInput,
  NotificationSentEntry,
  NotificationSentLog,
} from './notifications.interface';
import type { NotificationsService } from './notifications.service';
import { createNotifyByType } from './notify-by-type';
import { allSampleContexts } from './test-trigger';

vi.mock('../../db/redis', () => ({
  redisManager: { incrInFixedWindow: vi.fn(async () => 1) },
}));

const TENANT_ID = 'tenant-1';
const recipient = {
  id: 'recipient-1',
  tenantId: TENANT_ID,
  fullName: 'Asha Verma',
  email: 'asha@example.com',
  phoneNumber: '9876543210',
  whatsappOptIn: true,
  role: { name: 'org_admin' },
} as unknown as UserEntity;

function setup(loadChannelFacts?: LoadChannelFacts, sentLog?: NotificationSentLog) {
  const sent: CreateNotificationInput[] = [];
  const notifyByType = createNotifyByType({
    notificationsService: {
      hasNotificationOfType: vi.fn(async () => false),
      send: vi.fn(async (_tenantId: string, input: CreateNotificationInput) => {
        sent.push(input);
      }),
    } as unknown as NotificationsService,
    authRepository: {
      listUsersByRole: vi.fn(async () => [recipient]),
      listUsersWithPermission: vi.fn(async () => [{ ...recipient, role: { name: 'dispatcher' } }]),
      findUserById: vi.fn(async () => recipient),
    } as unknown as AuthRepository,
    authService: { getActiveDeviceTokensForUser: vi.fn(async () => []) } as unknown as AuthService,
    notificationPreferencesRepository: {
      findTypeByKey: vi.fn(async () => ({ id: 'type-1' })),
      findByTenantAndTypeId: vi.fn(async () => null),
      listUserPreferencesForType: vi.fn(async () => []),
      findQuietHours: vi.fn(async () => null),
    } as unknown as NotificationPreferencesRepository,
    loadChannelFacts,
    sentLog,
  });
  return { notifyByType, sent };
}

const samples = allSampleContexts('2026-10-27', 'caller-1');

describe('Channel rules in notify-by-type', () => {
  it('an update (Delivery will be late) no longer goes on WhatsApp; SMS stays', async () => {
    const { notifyByType, sent } = setup();
    await notifyByType(
      NOTIFICATION_CATALOG,
      'load.delivery_late',
      TENANT_ID,
      samples['load.delivery_late'] as never,
    );
    expect(sent.length).toBeGreaterThan(0);
    for (const input of sent) {
      expect(input.channels).not.toContain('whatsapp');
      expect(input.destinations?.whatsappNumber).toBeUndefined();
      expect(input.channels).toContain('sms');
    }
  });

  it('an action (driver reported a problem) keeps WhatsApp — unless the load memo has not gone yet', async () => {
    const own = setup({ forLoad: async () => ({ hasMemoStep: false, memoSent: false }) });
    await own.notifyByType(
      NOTIFICATION_CATALOG,
      'load.driver_problem_reported',
      TENANT_ID,
      samples['load.driver_problem_reported'] as never,
    );
    expect(own.sent[0].channels).toContain('whatsapp');

    const beforeMemo = setup({ forLoad: async () => ({ hasMemoStep: true, memoSent: false }) });
    await beforeMemo.notifyByType(
      NOTIFICATION_CATALOG,
      'load.driver_problem_reported',
      TENANT_ID,
      samples['load.driver_problem_reported'] as never,
    );
    expect(beforeMemo.sent[0].channels).not.toContain('whatsapp');
    expect(beforeMemo.sent[0].channels).toContain('sms');
  });

  it('types outside the load module are untouched (account approved keeps WhatsApp)', async () => {
    const { notifyByType, sent } = setup();
    await notifyByType(
      NOTIFICATION_CATALOG,
      'organization.account_approved',
      TENANT_ID,
      samples['organization.account_approved'] as never,
    );
    expect(sent[0].channels).toContain('whatsapp');
  });

  it("logs every channel of a load notification to the load's sent-log, dropped ones with the reason", async () => {
    const logged: NotificationSentEntry[] = [];
    const { notifyByType } = setup(undefined, {
      record: async (entries) => void logged.push(...entries),
    });
    await notifyByType(
      NOTIFICATION_CATALOG,
      'load.delivery_late',
      TENANT_ID,
      samples['load.delivery_late'] as never,
    );
    expect(logged.find((entry) => entry.channel === 'whatsapp')).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'update_app_only',
      type: 'load.delivery_late',
    });
    expect(logged.find((entry) => entry.channel === 'sms')).toMatchObject({
      status: 'queued',
      address: '9876543210',
    });
    expect(logged.every((entry) => entry.loadId && entry.recipient.id === 'recipient-1')).toBe(
      true,
    );
  });
});
