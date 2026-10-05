import { Job, UnrecoverableError, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { JobQueue } from '../../../jobs/queue-registry';
import { NOTIFICATION_CATALOG } from '../catalog/notification-catalog';
import { NotifyByType } from '../notify-by-type';
import {
  NOTIFICATION_TRIGGERS_QUEUE,
  NotificationContextResolvers,
  NotificationRelevanceChecks,
  NotificationTriggerPayload,
  occurrenceKey,
  reminderDedupeId,
  triggerOptionsOf,
} from '../notification-triggers';

/**
 * BullMQ Worker for the 'notification-triggers' queue (see notification-triggers.ts), started
 * in-process like the dispatch worker. Per job:
 *  1. skip if the type's relevance check (if any) says it's no longer worth sending, then let its
 *     context resolver (if any) finalise the content — or skip if it returns null;
 *  2. for a first send of a type with `reminderAfterMs`, (re)schedule its one reminder — before
 *     sending, so a retried job never sends twice just to reschedule; a reminder never schedules
 *     another, which is the "then stop";
 *  3. run notifyByType — a throw (notifyByType rethrows on any failure) makes BullMQ retry the job
 *     per the queue's defaultJobOptions.
 * Built in composition-root.ts, since notifyByType needs auth and the relevance checks read other
 * modules' state.
 */
export function createNotificationTriggerWorker(
  notifyByType: NotifyByType,
  triggersQueue: JobQueue,
  relevanceChecks: NotificationRelevanceChecks = {},
  contextResolvers: NotificationContextResolvers = {},
): Worker {
  return new Worker<NotificationTriggerPayload>(
    NOTIFICATION_TRIGGERS_QUEUE,
    async (job: Job<NotificationTriggerPayload>) => {
      const { type, tenantId, isReminder } = job.data;
      // A type removed from the catalog after its job was queued can never succeed — fail it
      // once (kept in the failed set for inspection) instead of burning retries.
      if (!(type in NOTIFICATION_CATALOG)) {
        throw new UnrecoverableError(`Unknown notification type "${type}"`);
      }
      // A reminder that's now running releases its dedupe key straight away: that key otherwise
      // lives for the full `ttl` (see the scheduling below), which would make a new trigger for
      // the same occurrence — e.g. the reviewer rejecting a re-uploaded copy — silently skip
      // scheduling its own reminder if this one ran any earlier than its ttl.
      if (isReminder) await job.removeDeduplicationKey();
      // Same for a debounced burst that's now being sent: a change arriving from here on starts
      // a fresh burst (and a fresh job) instead of being swallowed by this one's key.
      const { reminderAfterMs, debounceMs, delayMs } = triggerOptionsOf(type) ?? {};
      if (debounceMs || delayMs) await job.removeDeduplicationKey();

      let context = isReminder
        ? { ...(job.data.context as object), isReminder: true }
        : job.data.context;

      const isRelevant = relevanceChecks[type] as
        ((tenantId: string, context: unknown) => Promise<boolean>) | undefined;
      if (isRelevant && !(await isRelevant(tenantId, context))) return;

      const resolve = contextResolvers[type] as
        ((tenantId: string, context: unknown) => Promise<unknown>) | undefined;
      if (resolve) {
        const resolved = await resolve(tenantId, context);
        if (resolved === null) return; // nothing worth sending
        context = resolved;
      }

      const shouldRemind = (
        NOTIFICATION_CATALOG as Record<string, { shouldRemind?: (context: unknown) => boolean }>
      )[type]?.shouldRemind;
      if (reminderAfterMs && !isReminder && (shouldRemind?.(context) ?? true)) {
        // Debounce mode: a repeat trigger for the same occurrence replaces the still-delayed
        // reminder, restarting its clock, instead of stacking a second one.
        await triggersQueue.enqueue(
          type,
          { ...job.data, isReminder: true },
          {
            delay: reminderAfterMs,
            deduplication: {
              id: reminderDedupeId(type, occurrenceKey(type, tenantId, context) ?? tenantId),
              ttl: reminderAfterMs,
              extend: true,
              replace: true,
            },
          },
        );
      }

      await notifyByType(NOTIFICATION_CATALOG, type, tenantId, context as never);
    },
    { connection: getQueueConnection(), concurrency: 5 },
  );
}
