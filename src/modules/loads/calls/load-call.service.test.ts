import { describe, expect, it, vi } from 'vitest';
import type { LoadActivityService } from '../activity/load-activity.service';
import type { NotificationTriggers } from '../../notifications/notifications.interface';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadCallEntity } from './load-call.entity';
import type { LoadCallRepository } from './load-call.repository';
import { LoadCallService } from './load-call.service';

const NOW = new Date('2026-11-14T10:00:00Z');

function setup() {
  const calls: LoadCallEntity[] = [];
  const repository = {
    findLoad: vi.fn(async (loadId: string, tenantId?: string) =>
      tenantId && tenantId !== 'tenant-1'
        ? null
        : ({ id: loadId, tenantId: 'tenant-1', code: 'LOAD-0042' } as LoadEntity),
    ),
    create: vi.fn(async (data: Partial<LoadCallEntity>) => {
      const call = {
        id: `call-${calls.length + 1}`,
        reminderDoneAt: null,
        createdAt: NOW,
        ...data,
      } as LoadCallEntity;
      calls.push(call);
      return call;
    }),
    findById: vi.fn(async (id: string) => calls.find((call) => call.id === id) ?? null),
    listForLoad: vi.fn(async (_loadId: string, teams?: string[]) =>
      calls.filter((call) => !teams || teams.includes(call.team)),
    ),
    listOpenReminders: vi.fn(async (userId: string) =>
      calls.filter(
        (call) => call.calledByUserId === userId && call.reminderAt && !call.reminderDoneAt,
      ),
    ),
    markReminderDone: vi.fn(async () => undefined),
    userNames: vi.fn(
      async () =>
        new Map([
          ['user-1', 'Asha'],
          ['ls-user', 'Placement Priya'],
        ]),
    ),
    loadCodes: vi.fn(async () => new Map([['load-1', 'LOAD-0042']])),
  } as unknown as LoadCallRepository;
  const activity = { record: vi.fn(async () => undefined) };
  const enqueued: { type: string; options: unknown }[] = [];
  const triggers = {
    enqueue: vi.fn(async (type: string, _tenantId: string, _context: unknown, options: unknown) => {
      enqueued.push({ type, options });
    }),
  } as unknown as NotificationTriggers;
  const service = new LoadCallService(
    repository,
    activity as unknown as LoadActivityService,
    triggers,
    () => NOW,
  );
  return { service, calls, activity, enqueued };
}

const input = {
  parties: [{ role: 'driver' as const, name: 'Ramesh', phone: '9876543210' }],
  notes: 'Truck reaches the plant by 4 pm',
  outcome: 'picked_up' as const,
};

describe('LoadCallService (Log a call, spec p.36)', () => {
  it('logs a shipper call, notes it on the timeline and queues the reminder for its time', async () => {
    const { service, activity, enqueued } = setup();
    const view = await service.logShipperCall('tenant-1', 'user-1', 'load-1', {
      ...input,
      reminderAt: '2026-11-14T12:00:00Z',
    });
    expect(view).toMatchObject({
      team: 'shipper',
      calledBy: { id: 'user-1', name: 'Asha' },
      outcome: 'picked_up',
      reminderAt: '2026-11-14T12:00:00.000Z',
    });
    expect(activity.record).toHaveBeenCalledWith(
      'tenant-1',
      'load-1',
      'user-1',
      'CALL_LOGGED',
      null,
      null,
      expect.objectContaining({ parties: ['driver'], outcome: 'picked_up' }),
    );
    expect(enqueued).toEqual([{ type: 'call.reminder', options: { delayMs: 2 * 60 * 60 * 1000 } }]);
  });

  it('needs a price for outcome "price"; a reminder must be in the future; another tenant gets 404', async () => {
    const { service } = setup();
    await expect(
      service.logShipperCall('tenant-1', 'user-1', 'load-1', { ...input, outcome: 'price' }),
    ).rejects.toThrow(/price/);
    const priced = await service.logShipperCall('tenant-1', 'user-1', 'load-1', {
      ...input,
      outcome: 'price',
      price: 42000,
    });
    expect(priced.price).toBe('42000');
    await expect(
      service.logShipperCall('tenant-1', 'user-1', 'load-1', {
        ...input,
        reminderAt: '2026-11-14T09:00:00Z',
      }),
    ).rejects.toThrow(/future/);
    await expect(service.logShipperCall('other-tenant', 'user-1', 'load-1', input)).rejects.toThrow(
      /not found/,
    );
  });

  it("the shipper sees only its team's calls; Loadsmart sees all; a Loadsmart reminder sends no notification", async () => {
    const { service, enqueued } = setup();
    await service.logShipperCall('tenant-1', 'user-1', 'load-1', input);
    await service.logLoadsmartCall('ls-user', 'load-1', 'placement', {
      ...input,
      parties: [{ role: 'broker' }],
      reminderAt: '2026-11-14T11:00:00Z',
    });
    expect((await service.listForShipper('tenant-1', 'load-1')).map((call) => call.team)).toEqual([
      'shipper',
    ]);
    expect((await service.listForLoadsmart('load-1')).map((call) => call.team)).toEqual([
      'shipper',
      'placement',
    ]);
    expect(enqueued).toEqual([]);
  });

  it('my reminders: open ones with isDue; only the caller can close theirs; the notification stops once closed', async () => {
    const { service } = setup();
    const call = await service.logLoadsmartCall('ls-user', 'load-1', 'tracking', {
      ...input,
      reminderAt: '2026-11-14T11:00:00Z',
    });
    expect(await service.myReminders('ls-user')).toEqual([
      expect.objectContaining({ id: call.id, loadCode: 'LOAD-0042', isDue: false }),
    ]);
    await expect(service.markReminderDone('someone-else', call.id)).rejects.toThrow(/not found/);
    expect((await service.markReminderDone('ls-user', call.id)).reminderDoneAt).toBe(
      NOW.toISOString(),
    );
    expect(await service.openReminder(call.id, '2026-11-14T11:00:00.000Z')).toBeNull();
  });
});
