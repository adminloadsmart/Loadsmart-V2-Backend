import { Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { TrackingOutboxService } from '../tracking-outbox.service';

export const TRACKING_OUTBOX_QUEUE = 'tracking-outbox';
export const TRACKING_OUTBOX_RELAY_JOB = 'relay';

/**
 * BullMQ Worker on the `tracking-outbox` queue — runs TrackingOutboxService.relay() on the
 * repeating 'relay' job scheduled in modules/tracking/index.ts. Concurrency 1 per process; extra
 * app instances are safe too (the outbox claim uses FOR UPDATE SKIP LOCKED).
 */
export function createTrackingOutboxWorker(service: TrackingOutboxService): Worker {
  return new Worker(
    TRACKING_OUTBOX_QUEUE,
    async () => {
      await service.relay();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
}
