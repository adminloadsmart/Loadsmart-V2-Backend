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
}

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
      const { frequency } = (
        NOTIFICATION_CATALOG as Record<string, { frequency?: 'always' | 'once_per_tenant' }>
      )[type];
      const payload: NotificationTriggerPayload = { type, tenantId, context };
      // A once_per_tenant type gets a deterministic jobId, so two near-simultaneous triggers
      // (e.g. a double-clicked approve) collapse into one job while it's queued — BullMQ ignores
      // an add whose jobId already exists. After it completes, notify-by-type.ts's own
      // once_per_tenant check stops any repeat. No ':' in the id — BullMQ rejects it.
      await queue.enqueue(
        type,
        payload,
        frequency === 'once_per_tenant' ? { jobId: `${type}__${tenantId}` } : undefined,
      );
    },
  };
}
