import { describe, expect, it, vi } from 'vitest';
import type { AuthRepository } from '../auth/auth.repository';
import type { AuthService } from '../auth/auth.service';
import type { UserEntity } from '../auth/entities/user.entity';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationTypeDefinition } from './catalog/notification-catalog.types';
import type { NotificationPreferencesRepository } from './notification-preferences.repository';
import type { CreateNotificationInput, NotificationTypeKey } from './notifications.interface';
import type { NotificationsService } from './notifications.service';
import { createNotifyByType } from './notify-by-type';
import { allSampleContexts } from './test-trigger';

vi.mock('../../db/redis', () => ({
  redisManager: { incrInFixedWindow: vi.fn(async () => 1) },
}));
vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return { env: { ...actual.env, frontendBaseUrl: 'https://app.example.com' } };
});

const TENANT_ID = 'tenant-1';
const CALLER_ID = 'caller-1';

const recipient = {
  id: CALLER_ID,
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
    listUsersWithPermission: vi.fn(async () => [recipient]),
    findUserById: vi.fn(async () => recipient),
    findUserByIdIncludingRemoved: vi.fn(async () => recipient),
  } as unknown as AuthRepository;
  const authService = {
    getActiveDeviceTokensForUser: vi.fn(async () => []),
  } as unknown as AuthService;
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

const samples = allSampleContexts('2026-10-28', CALLER_ID);

/** Every email notification and the link its button opens (FRONTEND_BASE_URL + path). */
const EMAIL_CTA_URLS: [sheetId: string, type: NotificationTypeKey, ctaUrl: string][] = [
  ['LS_N_0001', 'organization.account_approved', 'https://app.example.com/home'],
  ['LS_N_0002', 'organization.signup_received', 'https://app.example.com/'],
  ['LS_N_0003', 'organization.document_more_info_needed', 'https://app.example.com/'],
  ['LS_N_0004', 'organization.account_not_approved', 'https://app.example.com/'],
  ['LS_N_0005', 'organization.team_member_invited', 'https://app.example.com/auth/login'],
  ['LS_N_0006', 'user.access_changed', 'https://app.example.com/home'],
  ['LS_N_0007', 'user.access_removed', ''],
  ['LS_N_0047', 'vehicle.documents_expiring_rollup', 'https://app.example.com/fleet'],
  [
    'LS_N_0048',
    'vehicle.compliance_expired',
    `https://app.example.com/fleet/${samples['vehicle.compliance_expired'].vehicleId}`,
  ],
  ['LS_N_0060', 'digest.daily_brief', 'https://app.example.com/home'],
  [
    'LS_N_0038',
    'load.pod_uploaded',
    `https://app.example.com/loads/${samples['load.pod_uploaded'].loadId}`,
  ],
  [
    'LS_N_0034',
    'load.shortage_recorded',
    `https://app.example.com/loads/${samples['load.shortage_recorded'].loadId}`,
  ],
];

describe('Email button link (cta_url)', () => {
  it('covers every type that has an email template', () => {
    const emailTypes = Object.entries(NOTIFICATION_CATALOG)
      .filter(
        ([, definition]) => (definition as NotificationTypeDefinition<unknown>).templates?.email,
      )
      .map(([type]) => type)
      .sort();
    expect(EMAIL_CTA_URLS.map(([, type]) => type).sort()).toEqual(emailTypes);
  });

  it.each(EMAIL_CTA_URLS)('%s %s', async (_sheetId, type, ctaUrl) => {
    const { notifyByType, sent } = setup();

    await notifyByType(NOTIFICATION_CATALOG, type, TENANT_ID, samples[type] as never);

    expect(sent.length).toBeGreaterThan(0);
    for (const input of sent) expect(input.metadata?.cta_url).toBe(ctaUrl);
  });
});
