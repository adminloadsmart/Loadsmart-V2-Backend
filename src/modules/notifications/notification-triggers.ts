import { JobQueue } from '../../jobs/queue-registry';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import {
  NotificationTriggerPayload,
  NotificationTriggerOptions,
  NotificationTriggers,
} from './notifications.interface';

/**
 * Queue-backed entry point for event-driven notifications (e.g. LS_N_0001 "account approved",
 * LS_N_0002 "signup received"): a trigger site enqueues `{ type, tenantId, context }` — one Redis
 * write inside the request — and workers/notification-trigger.worker.ts runs notifyByType
 * (recipients, content, preferences, delivery rows) out of the request, retried per the queue's
 * defaultJobOptions (see jobs/queue-registry.ts) if it fails. Delivery itself is then retried
 * again per channel by the existing 'notifications' queue — so neither stage is lost to a
 * transient DB/Redis hiccup.
 *
 * Only types in NOTIFICATION_CATALOG can be enqueued, and `context` is compile-time checked
 * against that type's buildContent — same guarantee notifyByType's own signature gives.
 */
export const NOTIFICATION_TRIGGERS_QUEUE = 'notification-triggers';

export function triggerOptionsOf(type: string): NotificationTriggerOptions | undefined {
  return (NOTIFICATION_CATALOG as Record<string, NotificationTriggerOptions>)[type];
}

/** Key identifying one occurrence of the event — tenant for once_per_tenant, else the type's own
 *  dedupeKey, else none (no collapsing). */
export function occurrenceKey(
  type: string,
  tenantId: string,
  context: unknown,
): string | undefined {
  const options = triggerOptionsOf(type);
  if (options?.frequency === 'once_per_tenant') return tenantId;
  return options?.dedupeKey?.(context);
}

// BullMQ deduplication ids — '__'-separated, never ':' (BullMQ rejects ':' in job ids).
export const triggerDedupeId = (type: string, key: string) => `${type}__${key}`;
export const reminderDedupeId = (type: string, key: string) => `${type}__reminder__${key}`;

export function createNotificationTriggers(queue: JobQueue): NotificationTriggers {
  return {
    async enqueue(type, tenantId, context, options) {
      const payload: NotificationTriggerPayload = { type, tenantId, context };
      // Near-simultaneous triggers for the same occurrence (e.g. a double-clicked approve/reject)
      // collapse into one job while it's pending (BullMQ deduplication, simple mode). The id is
      // released once that job completes or fails, so a genuine later repeat is still sent
      // (once_per_tenant types are then stopped by notify-by-type.ts's own check).
      const key = occurrenceKey(type, tenantId, context);
      const { debounceMs, delayMs: typeDelayMs } = triggerOptionsOf(type) ?? {};
      const delayMs = options?.delayMs ?? typeDelayMs;
      if (key && delayMs) {
        // Fixed delay from the first trigger: while that job waits, repeats are ignored (simple
        // dedupe) — they don't restart the clock.
        await queue.enqueue(type, payload, {
          delay: delayMs,
          deduplication: { id: triggerDedupeId(type, key) },
        });
        return;
      }
      if (key && debounceMs) {
        // Debounce mode: every trigger in a burst replaces the queued job's payload and restarts
        // its delay, so only one job — carrying the latest payload — runs after the burst ends.
        await queue.enqueue(type, payload, {
          delay: debounceMs,
          deduplication: {
            id: triggerDedupeId(type, key),
            ttl: debounceMs,
            extend: true,
            replace: true,
          },
        });
        return;
      }
      await queue.enqueue(
        type,
        payload,
        key ? { deduplication: { id: triggerDedupeId(type, key) } } : undefined,
      );
    },
  };
}
