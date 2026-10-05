import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { TrackingEventsConsumer } from './tracking-events.consumer';

const alert = (overrides: object = {}) =>
  JSON.stringify({
    id: 'a1',
    tenant_id: 't1',
    vehicle_id: 'v1',
    trip_id: 'l1',
    rule_id: 'HALT-GPS',
    severity: 'warning',
    title: 'Vehicle halted for 10+ minutes',
    ...overrides,
  });

function build(entries: Array<Record<string, string>>, seen = new Set<string>()) {
  const redis = {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi
      .fn()
      .mockResolvedValueOnce(null) // own pending: none
      .mockResolvedValueOnce([
        ['tracking.events', entries.map((fields, i) => [`${i}-0`, Object.entries(fields).flat()])],
      ]),
    xack: vi.fn().mockResolvedValue(1),
    exists: vi.fn(async (key: string) => (seen.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string) => (seen.add(key), 'OK')),
  };
  const dataSource = {
    query: vi.fn(async (sql: string) =>
      sql.includes('masters')
        ? [{ registration_number: 'MH12AB1234' }]
        : [{ code: 'LOAD-0007', vehicle_number: null }],
    ),
  } as unknown as DataSource;
  const notify = vi.fn().mockResolvedValue(undefined);
  return {
    consumer: new TrackingEventsConsumer(dataSource, () => redis as never, notify as never),
    notify,
    redis,
  };
}

describe('TrackingEventsConsumer', () => {
  it('notifies new alerts through the matching catalog type and acks every entry', async () => {
    const { consumer, notify, redis } = build([
      { eventId: '1', type: 'alert.opened', tenantId: 't1', payload: alert() },
      {
        eventId: '2',
        type: 'alert.opened',
        tenantId: 't1',
        payload: alert({ rule_id: 'DEV-GPS', title: 'Route deviation' }),
      },
      {
        eventId: '3',
        type: 'alert.opened',
        tenantId: 't1',
        payload: alert({ rule_id: 'OVER-GPS', title: 'Overspeeding' }),
      },
    ]);
    expect(await consumer.consume()).toBe(3);
    expect(notify.mock.calls.map((c) => c[1])).toEqual([
      'load.trip_delay_exception',
      'tracking.geofence_breach',
      'tracking.vehicle_alert',
    ]);
    expect(notify.mock.calls[0][3]).toEqual({
      title: 'Vehicle halted for 10+ minutes',
      vehicleNo: 'MH12AB1234',
      loadCode: 'LOAD-0007',
      severity: 'warning',
    });
    expect(redis.xack).toHaveBeenCalledTimes(3);
  });

  it('skips closes, info alerts and redelivered events, but still acks them', async () => {
    const seen = new Set(['tracking-events:seen:9']);
    const { consumer, notify, redis } = build(
      [
        { eventId: '7', type: 'alert.closed', tenantId: 't1', payload: alert() },
        {
          eventId: '8',
          type: 'alert.opened',
          tenantId: 't1',
          payload: alert({ severity: 'info' }),
        },
        { eventId: '9', type: 'alert.opened', tenantId: 't1', payload: alert() },
      ],
      seen,
    );
    await consumer.consume();
    expect(notify).not.toHaveBeenCalled();
    expect(redis.xack).toHaveBeenCalledTimes(3);
  });

  it('does not ack an entry whose notification failed (redelivered next run)', async () => {
    const { consumer, notify, redis } = build([
      { eventId: '1', type: 'alert.opened', tenantId: 't1', payload: alert() },
    ]);
    notify.mockRejectedValueOnce(new Error('db down'));
    await expect(consumer.consume()).rejects.toThrow('db down');
    expect(redis.xack).not.toHaveBeenCalled();
  });
});
