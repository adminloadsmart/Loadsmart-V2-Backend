import { describe, expect, it, vi } from 'vitest';
import type { AuthRepository } from '../auth/auth.repository';
import type { AuthService } from '../auth/auth.service';
import type { UserEntity } from '../auth/entities/user.entity';
import { AccessRemovedContext, NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationPreferencesRepository } from './notification-preferences.repository';
import type { CreateNotificationInput } from './notifications.interface';
import type { NotificationsService } from './notifications.service';
import { createNotifyByType } from './notify-by-type';

vi.mock('../../db/redis', () => ({
  redisManager: { incrInFixedWindow: vi.fn(async () => 1) },
}));

const TENANT_ID = 'tenant-1';

// Already soft-deleted when LS_N_0007 sends — findUserById no longer returns them.
const removedUser = {
  id: 'removed-1',
  tenantId: TENANT_ID,
  fullName: 'Ravi Kumar',
  email: 'ravi@example.com',
  phoneNumber: '9876543210',
  deletedAt: new Date(),
  role: { name: 'dispatch' },
} as unknown as UserEntity;

const admin = {
  id: 'admin-1',
  tenantId: TENANT_ID,
  fullName: 'Priya Sharma',
  email: 'priya@example.com',
  phoneNumber: '9876500000',
  role: { name: 'org_admin' },
} as unknown as UserEntity;

const context: AccessRemovedContext = {
  userId: removedUser.id,
  userName: 'Ravi Kumar',
  adminUserId: admin.id,
  adminName: 'Priya Sharma',
  orgName: 'Acme Logistics',
  reassignedTo: 'Priya Sharma',
};

function setup() {
  const sent: CreateNotificationInput[] = [];
  const notificationsService = {
    hasNotificationOfType: vi.fn(async () => false),
    send: vi.fn(async (_tenantId: string, input: CreateNotificationInput) => {
      sent.push(input);
    }),
  } as unknown as NotificationsService;
  const authRepository = {
    findUserById: vi.fn(async (id: string) => (id === admin.id ? admin : null)),
    findUserByIdIncludingRemoved: vi.fn(async (id: string) =>
      id === removedUser.id ? removedUser : id === admin.id ? admin : null,
    ),
  } as unknown as AuthRepository;
  const authService = {
    getActiveDeviceTokensForUser: vi.fn(async () => []),
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

describe('LS_N_0007 access removed', () => {
  it('emails the removed user even though they are already soft-deleted, and not in-app', async () => {
    const { notifyByType, sent } = setup();

    await notifyByType(NOTIFICATION_CATALOG, 'user.access_removed', TENANT_ID, context);

    expect(sent).toHaveLength(1);
    expect(sent[0].recipientUserId).toBe(removedUser.id);
    expect(sent[0].channels).toEqual(['email']);
    expect(sent[0].destinations?.email).toBe('ravi@example.com');
    expect(sent[0].body).toBe(
      'Ravi, your access to Acme Logistics on Loadsmart has been removed by Priya Sharma. Any trips assigned to you have moved to Priya Sharma.',
    );
    expect(sent[0].metadata).toMatchObject({
      first_name: 'Ravi',
      org_name: 'Acme Logistics',
      admin_name: 'Priya Sharma',
      reassigned_to: 'Priya Sharma',
    });
  });

  it('confirms to the org admin in-app', async () => {
    const { notifyByType, sent } = setup();

    await notifyByType(
      NOTIFICATION_CATALOG,
      'user.access_removed_confirmation',
      TENANT_ID,
      context,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].recipientUserId).toBe(admin.id);
    expect(sent[0].channels).toEqual([]);
    expect(sent[0].showInApp).toBe(true);
    expect(sent[0].title).toBe("Ravi Kumar's access to Acme Logistics has been removed");
  });

  it('a type without recipientMayBeRemoved still skips a removed user', async () => {
    const { notifyByType, sent } = setup();

    await notifyByType(NOTIFICATION_CATALOG, 'user.access_changed', TENANT_ID, {
      ...context,
      baselinePermissions: [],
      addedCapabilities: 'approve masters',
    } as never);

    expect(sent).toHaveLength(0);
  });
});
