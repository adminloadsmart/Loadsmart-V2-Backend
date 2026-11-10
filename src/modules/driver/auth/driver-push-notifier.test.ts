import { describe, expect, it, vi } from 'vitest';
import type { Msg91Client } from '../../../adapters/msg91.client';
import type { PushChannel } from '../../notifications/channels/push.channel';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { DriverMessage } from '../../notifications/notifications.types';
import type { DriverSessionRepository } from './driver-auth.repository';
import { DriverPushNotifier } from './driver-push-notifier';

const message: DriverMessage = {
  type: 'load.loading_contact_changed',
  params: { loadCode: 'LOAD-1115', name: 'Ravi', phoneNumber: '9876543210' },
};

function setup(sessions: { fcmToken: string | null; locale: string | null }[]) {
  const send = vi.fn(async () => ({ id: 'notification-1' }));
  const push = vi.fn(async () => undefined);
  const notifier = new DriverPushNotifier(
    { findActiveByDriverId: vi.fn(async () => sessions) } as unknown as DriverSessionRepository,
    { send } as unknown as NotificationsService,
    { send: push } as unknown as PushChannel,
    {} as Msg91Client,
  );
  return { notifier, send, push };
}

describe('DriverPushNotifier.notifyLoadUpdate — new load / loading contact or point changed', () => {
  it('saves the in-app card even when the driver is not signed in anywhere', async () => {
    const { notifier, send, push } = setup([]);
    await notifier.notifyLoadUpdate('tenant-1', 'driver-1', message, { loadIds: ['load-1'] });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        recipientUserId: 'driver-1',
        type: 'load.loading_contact_changed',
        channels: [],
        severity: 'p2_action',
        metadata: expect.objectContaining({ loadIds: ['load-1'], messageParams: message.params }),
      }),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('saves one card however many devices, and pushes to each signed-in one with its id', async () => {
    const { notifier, send, push } = setup([
      { fcmToken: 'token-a', locale: 'en' },
      { fcmToken: 'token-b', locale: 'hi' },
    ]);
    await notifier.notifyLoadUpdate('tenant-1', 'driver-1', message, { loadIds: ['load-1'] });

    expect(send).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          loadIds: ['load-1'],
          type: 'load.loading_contact_changed',
          notificationId: 'notification-1',
        }),
        severity: 'p2_action',
      }),
      'token-a',
    );
    expect(push).toHaveBeenCalledWith(expect.anything(), 'token-b');
  });

  it('never throws when saving the card fails — the push still goes', async () => {
    const { notifier, send, push } = setup([{ fcmToken: 'token-a', locale: null }]);
    send.mockRejectedValueOnce(new Error('db down'));
    await expect(
      notifier.notifyLoadUpdate('tenant-1', 'driver-1', message, { loadIds: ['load-1'] }),
    ).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
