import { JobQueue } from '../../jobs/queue-registry';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import { NotificationTypeDefinition } from './catalog/notification-catalog.types';

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

type Catalog = typeof NOTIFICATION_CATALOG;
export type NotificationTypeKey = keyof Catalog & string;
export type NotificationContextOf<K extends NotificationTypeKey> =
  Catalog[K] extends NotificationTypeDefinition<infer TContext> ? TContext : never;

export interface NotificationTriggerPayload {
  type: NotificationTypeKey;
  tenantId: string;
  context: unknown;
  /** Set on the one reminder job scheduled for a type with `reminderAfterMs`. */
  isReminder?: boolean;
}

/** Per-type "is this still worth sending?" checks, run by the trigger worker right before each
 *  send (initial and reminder) — e.g. LS_N_0003 only while the document is still invalid. A type
 *  without one is always sent. Supplied by composition-root.ts, since the checks read other
 *  modules' state. */
export type NotificationRelevanceChecks = {
  [K in NotificationTypeKey]?: (
    tenantId: string,
    context: NotificationContextOf<K>,
  ) => Promise<boolean>;
};

/** Per-type hook that finalises the context right before sending — e.g. LS_N_0006 turns
 *  "capabilities before the change" into the actual added/removed lists. Returning null means
 *  there's nothing worth sending (e.g. the changes cancelled out). Supplied by
 *  composition-root.ts, like relevance checks. */
export type NotificationContextResolvers = {
  [K in NotificationTypeKey]?: (
    tenantId: string,
    context: NotificationContextOf<K>,
  ) => Promise<NotificationContextOf<K> | null>;
};

interface TriggerOptions {
  frequency?: 'always' | 'once_per_tenant';
  dedupeKey?: (context: unknown) => string;
  reminderAfterMs?: number;
  debounceMs?: number;
}

export function triggerOptionsOf(type: string): TriggerOptions | undefined {
  return (NOTIFICATION_CATALOG as Record<string, TriggerOptions>)[type];
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

export interface NotificationTriggers {
  enqueue<K extends NotificationTypeKey>(
    type: K,
    tenantId: string,
    context: NotificationContextOf<K>,
  ): Promise<void>;
}

export function createNotificationTriggers(queue: JobQueue): NotificationTriggers {
  return {
    async enqueue(type, tenantId, context) {
      const payload: NotificationTriggerPayload = { type, tenantId, context };
      // Near-simultaneous triggers for the same occurrence (e.g. a double-clicked approve/reject)
      // collapse into one job while it's pending (BullMQ deduplication, simple mode). The id is
      // released once that job completes or fails, so a genuine later repeat is still sent
      // (once_per_tenant types are then stopped by notify-by-type.ts's own check).
      const key = occurrenceKey(type, tenantId, context);
      const debounceMs = triggerOptionsOf(type)?.debounceMs;
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
