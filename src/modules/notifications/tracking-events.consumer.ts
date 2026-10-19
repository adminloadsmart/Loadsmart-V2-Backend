import Redis from 'ioredis';
import { hostname } from 'os';
import { stopPlaceKindOf } from './halt-exclusions';
import { NotificationTriggers } from './notification-triggers';
import {
  VEHICLE_HALT_ALERT_STEPS,
  TRACKING_EVENT_SEEN_TTL_SECONDS,
  TRACKING_EVENTS_BATCH_SIZE,
  TRACKING_EVENTS_BLOCK_MS,
  TRACKING_EVENTS_CLAIM_IDLE_MS,
  TRACKING_EVENTS_ERROR_BACKOFF_MS,
  TRACKING_EVENTS_MAX_ATTEMPTS,
} from './notifications.constants';
import type { GeofenceTransitionNotice } from '../geofences/utils/geofence.interface';
import { TrackingEvent, TrackingEventHandlers } from './notifications.interface';
import { TrackingEventType } from './notifications.types';

/**
 * Listener for the loadsmart-tracking service's events. Tracking writes each event to its outbox
 * in the same transaction as the change, then relays it to this Redis stream (XADD fields:
 * `eventId`, `type`, `tenantId`, `payload` JSON) — see the tracking repo's outbox.relay.ts.
 *
 * Read as a consumer group, so every event is handled by one backend instance, survives restarts
 * (unacknowledged entries stay pending) and is picked up by another instance if this one dies
 * (XAUTOCLAIM after TRACKING_EVENTS_CLAIM_IDLE_MS). Relays can repeat an event, so each `eventId`
 * is handled once (TRACKING_EVENT_SEEN_TTL_SECONDS). A handler that keeps failing is given up on
 * after TRACKING_EVENTS_MAX_ATTEMPTS and logged.
 * Event types without a handler (e.g. alert.closed / alert.escalated) are acknowledged and
 * skipped.
 */
export const TRACKING_EVENTS_STREAM = 'tracking.events';
export const TRACKING_EVENTS_CONSUMER_GROUP = 'loadsmart-backend';

/** What each event type does here. `markArrivedAtPickup` / `markDepartedPickup` /
 *  `markReachedDeliveryPoint` are LoadService's — tracking's arrival moves the load to "At plant"
 *  (raises LS_N_0022, stops LS_N_0021), its departure to "In transit", its drop arrival to
 *  "Reached delivery point". `notifyGeofenceTransition` is GeofenceService's — the geofence's own
 *  "Send alerts to". */
export function createTrackingEventHandlers(
  triggers: NotificationTriggers,
  deps: {
    markArrivedAtPickup(tenantId: string, loadId: string, at: Date): Promise<boolean>;
    markDepartedPickup(tenantId: string, loadId: string, at: Date): Promise<boolean>;
    markReachedDeliveryPoint(tenantId: string, loadId: string, at: Date): Promise<boolean>;
    notifyGeofenceTransition(notice: GeofenceTransitionNotice): Promise<void>;
  },
): TrackingEventHandlers {
  const geofenceTransition =
    (event: 'enter' | 'exit') =>
    async (trackingEvent: TrackingEvent): Promise<void> => {
      const geofenceId = stringOf(trackingEvent.payload.geofenceId);
      const vehicleId = stringOf(trackingEvent.payload.vehicleId);
      if (!geofenceId || !vehicleId || !trackingEvent.tenantId) {
        console.warn(
          `tracking event ${trackingEvent.eventId}: ${trackingEvent.type} without geofence/vehicle/tenant`,
        );
        return;
      }
      await deps.notifyGeofenceTransition({
        tenantId: trackingEvent.tenantId,
        geofenceId,
        vehicleId,
        vehicleNumber: stringOf(trackingEvent.payload.vehicleNumber),
        event,
        loadId: stringOf(trackingEvent.payload.loadId),
        at: occurredAtOf(trackingEvent),
      });
    };

  return {
    // LS_N_0022 / LS_N_0021 / LS_N_0023's clock — the vehicle entered the loading point's geofence.
    'trip.arrived_at_pickup': async (event) => {
      const loadId = stringOf(event.payload.loadId);
      if (!loadId || !event.tenantId) {
        console.warn(
          `tracking event ${event.eventId}: trip.arrived_at_pickup without loadId/tenantId`,
        );
        return;
      }
      await deps.markArrivedAtPickup(event.tenantId, loadId, occurredAtOf(event));
    },
    // LS_N_0026 — the loaded vehicle left the loading point's geofence (tracking sends this only
    // once loading is confirmed). A "loading confirmed" load moves to "In transit" at that time;
    // one already marked in transit by hand stays as it is. The card goes out either way.
    'trip.departed_pickup': async (event) => {
      const loadId = stringOf(event.payload.loadId);
      if (!loadId || !event.tenantId) {
        console.warn(
          `tracking event ${event.eventId}: trip.departed_pickup without loadId/tenantId`,
        );
        return;
      }
      const departedAt = occurredAtOf(event);
      await deps.markDepartedPickup(event.tenantId, loadId, departedAt);
      await triggers.enqueue('load.vehicle_in_transit', event.tenantId, {
        loadId,
        departedAt: departedAt.toISOString(),
      });
    },
    // In transit → Reached delivery point — the vehicle entered the drop point's geofence.
    'trip.arrived_at_drop': async (event) => {
      const loadId = stringOf(event.payload.loadId);
      if (!loadId || !event.tenantId) {
        console.warn(
          `tracking event ${event.eventId}: trip.arrived_at_drop without loadId/tenantId`,
        );
        return;
      }
      await deps.markReachedDeliveryPoint(event.tenantId, loadId, occurredAtOf(event));
    },
    // The geofence's own enter / exit alert (any geofence type, trip or not).
    'geofence.entered': geofenceTransition('enter'),
    'geofence.exited': geofenceTransition('exit'),
    // LS_N_0027 — tracking's HALT-GPS alert (raised 10 min into an in-transit halt). Queues the
    // halt's 2 h and 6 h checks; each re-checks at send time that the truck is still standing
    // there, outside a known stop, with the ETA slipping (load-alerts.ts vehicleHalted). The
    // payload is tracking's alert row (snake_case); other rules' alerts are ignored.
    'alert.opened': async (event) => {
      if (event.payload.rule_id !== 'HALT-GPS') return;
      const loadId = stringOf(event.payload.trip_id);
      const haltAlertId = stringOf(event.payload.id);
      const details = objectOf(event.payload.payload);
      const anchor = objectOf(details.anchor);
      const anchorLat = Number(anchor.lat);
      const anchorLng = Number(anchor.lng);
      const haltStartedAt =
        dateOf(details.haltStartedAt) ?? dateOf(event.payload.occurred_at) ?? new Date();
      if (
        !loadId ||
        !haltAlertId ||
        !event.tenantId ||
        !Number.isFinite(anchorLat) ||
        !Number.isFinite(anchorLng)
      ) {
        console.warn(
          `tracking event ${event.eventId}: HALT-GPS alert without trip/alert id, tenant or anchor`,
        );
        return;
      }
      for (const { step, afterMs } of VEHICLE_HALT_ALERT_STEPS) {
        await triggers.enqueue(
          'load.vehicle_halted',
          event.tenantId,
          {
            loadId,
            haltAlertId,
            haltStartedAt: haltStartedAt.toISOString(),
            anchorLat,
            anchorLng,
            stopPlaceKind: stopPlaceKindOf(details.stopPlaceKind),
            step,
          },
          { delayMs: Math.max(1, haltStartedAt.getTime() + afterMs - Date.now()) },
        );
      }
    },
  };
}

const objectOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const dateOf = (value: unknown): Date | null => {
  const text = stringOf(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text) : null;
};

/** The event's `occurredAt`, else now (a missing/invalid time never drops the event). */
function occurredAtOf(event: TrackingEvent): Date {
  const occurredAt = stringOf(event.payload.occurredAt);
  return occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt) : new Date();
}

const stringOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

type StreamEntry = [id: string, fields: string[]];

function parseEntry([streamId, fields]: StreamEntry): TrackingEvent {
  const map: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) map[fields[i]] = fields[i + 1];
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(map.payload ?? '{}');
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    // Malformed payload — handlers see an empty one and skip it.
  }
  return {
    streamId,
    eventId: map.eventId || streamId,
    type: map.type ?? '',
    tenantId: map.tenantId || stringOf(payload.tenantId) || '',
    payload,
  };
}

/** Starts reading straight away; `close()` (graceful shutdown) stops after the current batch. */
export function startTrackingEventsConsumer(
  redisUrl: string,
  handlers: TrackingEventHandlers,
): { close(): Promise<void> } {
  // Its own connection: XREADGROUP BLOCK holds it while waiting.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const consumer = `${hostname()}-${process.pid}`;
  let stopping = false;

  const ensureGroup = async () => {
    try {
      // '$': start from events published after the group is first created — not a replay of the
      // stream's backlog (up to ~100k old events) on the first deploy.
      await redis.xgroup(
        'CREATE',
        TRACKING_EVENTS_STREAM,
        TRACKING_EVENTS_CONSUMER_GROUP,
        '$',
        'MKSTREAM',
      );
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
  };

  const handle = async (entry: StreamEntry) => {
    const event = parseEntry(entry);
    const seenKey = `tracking-event:seen:${event.eventId}`;
    const handler = handlers[event.type as TrackingEventType];
    if (handler && !(await redis.exists(seenKey))) {
      try {
        await handler(event);
      } catch (error) {
        const attemptsKey = `tracking-event:attempts:${event.eventId}`;
        const attempts = await redis.incr(attemptsKey);
        await redis.expire(attemptsKey, TRACKING_EVENT_SEEN_TTL_SECONDS);
        if (attempts < TRACKING_EVENTS_MAX_ATTEMPTS) {
          // Left pending — XAUTOCLAIM hands it back after CLAIM_IDLE_MS.
          console.warn(`tracking event ${event.eventId} (${event.type}) failed, will retry`, error);
          return;
        }
        console.error(
          `tracking event ${event.eventId} (${event.type}) failed ${attempts} times, giving up`,
          error,
        );
      }
      await redis.set(seenKey, '1', 'EX', TRACKING_EVENT_SEEN_TTL_SECONDS);
    }
    await redis.xack(TRACKING_EVENTS_STREAM, TRACKING_EVENTS_CONSUMER_GROUP, event.streamId);
  };

  const loop = async () => {
    let groupReady = false;
    while (!stopping) {
      try {
        if (!groupReady) {
          await ensureGroup();
          groupReady = true;
        }
        // Entries another (dead) instance — or this one, on a failed handler — left pending.
        const [, claimed] = (await redis.xautoclaim(
          TRACKING_EVENTS_STREAM,
          TRACKING_EVENTS_CONSUMER_GROUP,
          consumer,
          TRACKING_EVENTS_CLAIM_IDLE_MS,
          '0-0',
          'COUNT',
          TRACKING_EVENTS_BATCH_SIZE,
        )) as [string, StreamEntry[]];
        for (const entry of claimed ?? []) await handle(entry);

        const result = (await redis.xreadgroup(
          'GROUP',
          TRACKING_EVENTS_CONSUMER_GROUP,
          consumer,
          'COUNT',
          TRACKING_EVENTS_BATCH_SIZE,
          'BLOCK',
          TRACKING_EVENTS_BLOCK_MS,
          'STREAMS',
          TRACKING_EVENTS_STREAM,
          '>',
        )) as [string, StreamEntry[]][] | null;
        for (const [, entries] of result ?? []) {
          for (const entry of entries) await handle(entry);
        }
      } catch (error) {
        if (stopping) break;
        console.error('tracking.events consumer error', error);
        groupReady = false;
        await new Promise((resolve) => setTimeout(resolve, TRACKING_EVENTS_ERROR_BACKOFF_MS));
      }
    }
  };

  const running = loop();
  return {
    async close() {
      stopping = true;
      await running;
      await redis.quit();
    },
  };
}
