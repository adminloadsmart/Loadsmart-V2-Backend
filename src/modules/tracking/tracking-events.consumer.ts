import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { NOTIFICATION_CATALOG } from '../notifications/catalog/notification-catalog';
import { NotifyByType } from '../notifications/notify-by-type';

/** Stream the loadsmart-tracking service publishes alert events to (its rules/outbox.relay.ts). */
export const TRACKING_EVENTS_STREAM = 'tracking.events';
const GROUP = 'loadsmart-notifications';
const CONSUMER = 'main-backend';
const BATCH = 200;
// An event id seen within this window is a redelivery — never notify twice.
const DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

/** Tracking rule → which notification type (and so which settings-screen row / recipients). */
const TYPE_BY_RULE: Record<
  string,
  'load.trip_delay_exception' | 'tracking.geofence_breach' | 'tracking.vehicle_alert'
> = {
  'DELAY-GPS': 'load.trip_delay_exception',
  'DELAY-SIM': 'load.trip_delay_exception',
  'HALT-GPS': 'load.trip_delay_exception',
  'HALT-SIM': 'load.trip_delay_exception',
  'DEV-GPS': 'tracking.geofence_breach',
  'DEV-SIM': 'tracking.geofence_breach',
};

interface AlertPayload {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  trip_id: string | null;
  rule_id: string;
  severity: string;
  title: string;
}

/**
 * Consumes the tracking service's alert events and notifies the organization through the normal
 * notifications pipeline (roles, channels and org preferences per notification type). Only new
 * alerts and escalations notify; closes, repeats and Info-level alerts don't. Run as a repeating
 * BullMQ job (non-blocking XREADGROUP), so it shares the outbox relay's worker and shutdown path.
 * At-least-once: an entry is acked only after it was handled; event ids are de-duplicated.
 */
export class TrackingEventsConsumer {
  private groupReady = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: () => Redis,
    private readonly notifyByType: NotifyByType,
  ) {}

  async consume(): Promise<number> {
    const redis = this.redis();
    if (!this.groupReady) {
      try {
        await redis.xgroup('CREATE', TRACKING_EVENTS_STREAM, GROUP, '0', 'MKSTREAM');
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
      }
      this.groupReady = true;
    }

    let handled = 0;
    // First our own unacked entries (a previous run failed mid-batch), then new ones.
    for (const id of ['0', '>']) {
      const reply = (await redis.xreadgroup(
        'GROUP',
        GROUP,
        CONSUMER,
        'COUNT',
        BATCH,
        'STREAMS',
        TRACKING_EVENTS_STREAM,
        id,
      )) as Array<[string, Array<[string, string[]]>]> | null;
      for (const [entryId, flat] of reply?.[0]?.[1] ?? []) {
        const fields: Record<string, string> = {};
        for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
        await this.handle(fields);
        await redis.xack(TRACKING_EVENTS_STREAM, GROUP, entryId);
        handled += 1;
      }
    }
    return handled;
  }

  private async handle(fields: Record<string, string>): Promise<void> {
    if (fields.type !== 'alert.opened' && fields.type !== 'alert.escalated') return;
    // Mark as seen only AFTER notifying: a failed notification must be retried, not swallowed
    // (worst case on a crash between the two is one duplicate notification, never a lost one).
    const seenKey = `tracking-events:seen:${fields.eventId}`;
    if (await this.redis().exists(seenKey)) return;

    const alert = JSON.parse(fields.payload) as AlertPayload;
    if (alert.severity === 'info') return;

    const [vehicle] = await this.dataSource.query(
      `SELECT "registration_number" FROM "masters"."vehicles" WHERE "id" = $1`,
      [alert.vehicle_id],
    );
    // Market trucks aren't in the vehicle master: fall back to the load's free-text plate.
    const [load] = alert.trip_id
      ? await this.dataSource.query(
          `SELECT "code", "vehicle_number" FROM "loads"."loads" WHERE "id" = $1`,
          [alert.trip_id],
        )
      : [];

    await this.notifyByType(
      NOTIFICATION_CATALOG,
      TYPE_BY_RULE[alert.rule_id] ?? 'tracking.vehicle_alert',
      alert.tenant_id,
      {
        title:
          fields.type === 'alert.escalated'
            ? `${alert.title} (now ${alert.severity})`
            : alert.title,
        vehicleNo: vehicle?.registration_number ?? load?.vehicle_number ?? 'vehicle',
        loadCode: load?.code ?? null,
        severity: alert.severity,
      },
    );
  }
}
