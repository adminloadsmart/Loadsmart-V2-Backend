import { describe, expect, it, vi } from 'vitest';
import type { NotificationEntity } from '../../notifications/notifications.entity';
import type { LoadEntity } from '../../loads/entities/load.entity';
import { processPodReminder } from '../../loads/alerts/pod-reminder';
import { PodCardLoad } from './driver-portal.types';
import { podCardLoadOf, podCardLoadRefOf, podCardStateOf } from './pod-card';

const reminder = (metadata: Record<string, unknown>, type = 'driver.trip.pod_reminder') =>
  ({ type, tenantId: 'tenant-1', metadata }) as unknown as NotificationEntity;

const atDrop: PodCardLoad = {
  id: 'load-1',
  tenantId: 'tenant-1',
  code: 'LOAD-1112',
  driverId: 'driver-1',
  status: 'reached_unloading',
  podStatus: null,
  podFileKey: null,
};

function stateOf(
  load: Partial<PodCardLoad> | null,
  metadata: Record<string, unknown> = { loadId: 'load-1' },
) {
  const ref = podCardLoadRefOf(reminder(metadata))!;
  const loads = load ? [{ ...atDrop, ...load }] : [];
  return podCardStateOf(ref, podCardLoadOf(ref, loads), 'driver-1');
}

describe('driver app — "Upload the E-POD" card flag', () => {
  it('is actionable while the truck is at the drop with no E-POD', () => {
    expect(stateOf({})).toEqual({ loadId: 'load-1', status: 'not_uploaded', actionable: true });
  });

  it('turns off once the E-POD is uploaded, and stays off once it is accepted', () => {
    const uploaded = {
      status: 'delivered_ok' as const,
      podStatus: 'pending' as const,
      podFileKey: 'pod.jpg',
    };
    expect(stateOf(uploaded)).toEqual({
      loadId: 'load-1',
      status: 'under_review',
      actionable: false,
    });
    expect(stateOf({ ...uploaded, podStatus: 'accepted' })).toMatchObject({
      status: 'accepted',
      actionable: false,
    });
  });

  it('turns back on after a rejection, until a new copy is uploaded', () => {
    expect(
      stateOf({ status: 'delivered_ok', podStatus: 'rejected', podFileKey: 'pod.jpg' }),
    ).toEqual({ loadId: 'load-1', status: 'rejected', actionable: true });
  });

  it('is unavailable when the load is gone or now another driver’s', () => {
    expect(stateOf(null)).toEqual({ loadId: 'load-1', status: 'unavailable', actionable: false });
    expect(stateOf({ driverId: 'driver-2' })).toMatchObject({
      status: 'unavailable',
      actionable: false,
    });
  });

  it('finds an older card’s load by its code within the card’s tenant', () => {
    const older = { messageParams: { loadCode: 'LOAD-1112', vehicleNumber: null } };
    expect(stateOf({}, older)).toEqual({
      loadId: 'load-1',
      status: 'not_uploaded',
      actionable: true,
    });
    // Same code in another tenant is not this card's load.
    expect(stateOf({ tenantId: 'tenant-2' }, older)).toBeNull();
  });

  it('leaves every other notification alone', () => {
    expect(podCardLoadRefOf(reminder({ loadId: 'load-1' }, 'driver.account.invited'))).toBeNull();
  });

  it('saves the load id on new reminders', async () => {
    const notifier = {
      notifyTripReminder: vi.fn(async () => undefined),
      notifyLoadUpdate: vi.fn(async () => undefined),
    };
    const load = { ...atDrop, vehicleNumber: 'MH12AB1234' } as unknown as LoadEntity;
    await processPodReminder(
      { tenantId: 'tenant-1', loadId: 'load-1' } as never,
      { findById: async () => load },
      notifier,
    );
    expect(notifier.notifyTripReminder).toHaveBeenCalledWith(
      'tenant-1',
      'driver-1',
      {
        type: 'driver.trip.pod_reminder',
        params: { loadId: 'load-1', loadCode: 'LOAD-1112', vehicleNumber: 'MH12AB1234' },
      },
      { loadId: 'load-1' },
    );
  });
});
