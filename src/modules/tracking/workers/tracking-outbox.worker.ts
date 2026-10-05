import { Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { TrackingEventsConsumer } from '../tracking-events.consumer';
import { TrackingOutboxService } from '../tracking-outbox.service';

export const TRACKING_OUTBOX_QUEUE = 'tracking-outbox';
export const TRACKING_OUTBOX_RELAY_JOB = 'relay';
export const TRACKING_EVENTS_CONSUME_JOB = 'consume-events';

/**
 * BullMQ Worker on the `tracking-outbox` queue, for the two repeating jobs scheduled in
 * modules/tracking/index.ts: 'relay' (our changes → loadsmart.events, TrackingOutboxService) and
 * 'consume-events' (the tracking service's alerts → notifications, TrackingEventsConsumer).
 * Concurrency 1 per process; extra app instances are safe too (SKIP LOCKED claim on the outbox;
 * one consumer group with acked, de-duplicated entries on the events stream).
 */
export function createTrackingOutboxWorker(
  service: TrackingOutboxService,
  eventsConsumer: TrackingEventsConsumer,
): Worker {
  return new Worker(
    TRACKING_OUTBOX_QUEUE,
    async (job) => {
      if (job.name === TRACKING_EVENTS_CONSUME_JOB) await eventsConsumer.consume();
      else await service.relay();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
}
