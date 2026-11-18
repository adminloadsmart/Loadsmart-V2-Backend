import { describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import { createLoadEventNotifier } from './load-alerts';
import type { NotificationTriggers } from './notifications.interface';

describe('load.stage_changed — every stage change reaches the shipper in the app (spec p.30)', () => {
  function notifier() {
    const enqueued: { type: string; context: unknown }[] = [];
    const triggers = {
      enqueue: vi.fn(async (type: string, _tenantId: string, context: unknown) => {
        enqueued.push({ type, context });
      }),
    } as unknown as NotificationTriggers;
    return { notify: createLoadEventNotifier(triggers), enqueued };
  }
  const at = new Date('2026-11-14T10:00:00Z');

  it('sends the generic card for stages without a notification of their own', async () => {
    const { notify, enqueued } = notifier();
    for (const to of [
      'bids_received',
      'in_transit_loading',
      'invoice_generated',
      'payment',
      'closed',
    ] as const) {
      await notify({ kind: 'stage_changed', tenantId: 'tenant-1', loadId: 'load-1', to, at });
    }
    expect(enqueued.map((item) => (item.context as { stage: string }).stage)).toEqual([
      'bids_received',
      'in_transit_loading',
      'invoice_generated',
      'payment',
      'closed',
    ]);
    expect(enqueued.every((item) => item.type === 'load.stage_changed')).toBe(true);
  });

  it('skips stages that already have their own notification (no double cards)', async () => {
    const { notify, enqueued } = notifier();
    for (const to of [
      'truck_assigned',
      'reached_loading',
      'loaded',
      'in_transit_unloading',
      'reached_unloading',
      'delivered_ok',
      'delivered_with_issues',
    ] as const) {
      await notify({ kind: 'stage_changed', tenantId: 'tenant-1', loadId: 'load-1', to, at });
    }
    expect(enqueued).toEqual([]);
  });

  it('is in-app only (an update: no WhatsApp, SMS, email or push)', () => {
    const definition = NOTIFICATION_CATALOG['load.stage_changed'];
    expect(definition.channels).toEqual([]);
    expect(definition.intent).toBe('update');
    const content = definition.buildContent({
      loadId: 'load-1',
      loadCode: 'LOAD-0042',
      route: 'Ludhiana to Bhiwandi',
      stage: 'invoice_generated',
      changedAt: at.toISOString(),
    });
    expect(content.title).toBe('LOAD-0042: Invoice generated');
  });
});
