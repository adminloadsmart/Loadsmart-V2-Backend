import { Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { TrackingEventsConsumer } from '../tracking-events.consumer';

export const TRACKING_EVENTS_QUEUE = 'tracking-events';
export const TRACKING_EVENTS_CONSUME_JOB = 'consume-events';

/**
 * BullMQ Worker on the `tracking-events` queue — runs TrackingEventsConsumer on the repeating
 * 'consume-events' job scheduled in modules/tracking/index.ts: the loadsmart-tracking service's
 * alerts become notifications here. Concurrency 1 per process; extra app instances are safe too
 * (one consumer group, acked and de-duplicated entries).
 */
export function createTrackingEventsWorker(eventsConsumer: TrackingEventsConsumer): Worker {
  return new Worker(
    TRACKING_EVENTS_QUEUE,
    async () => {
      await eventsConsumer.consume();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
}
