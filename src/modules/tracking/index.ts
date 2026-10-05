import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { getQueueConnection } from '../../jobs/queue-connection';
import { upsertRepeatingJob } from '../../jobs/queue-registry';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { createTrackingRoutes } from './tracking.routes';
import { TrackingOutboxRepository } from './tracking-outbox.repository';
import { TrackingOutboxService } from './tracking-outbox.service';
import {
  createTrackingOutboxWorker,
  TRACKING_OUTBOX_QUEUE,
  TRACKING_OUTBOX_RELAY_JOB,
} from './workers/tracking-outbox.worker';

// How often the outbox relay publishes changes to the loadsmart-tracking service.
const OUTBOX_RELAY_EVERY_MS = 2000;

export function createTrackingModule(dataSource: DataSource) {
  const repository = new TrackingRepository(dataSource);
  const service = new TrackingService(repository);
  const controller = new TrackingController(service);
  const router = createTrackingRoutes(controller);

  // Outbox relay → `loadsmart.events` stream (see migration TrackingOutbox1790100000000). Uses the
  // BullMQ connection for XADD — any client on this Redis works, and this one already exists.
  const outboxService = new TrackingOutboxService(
    new TrackingOutboxRepository(dataSource),
    getQueueConnection,
  );
  const outboxWorker: Worker = createTrackingOutboxWorker(outboxService);
  upsertRepeatingJob(
    TRACKING_OUTBOX_QUEUE,
    'tracking-outbox-relay',
    OUTBOX_RELAY_EVERY_MS,
    TRACKING_OUTBOX_RELAY_JOB,
  ).catch((err) => console.error('Failed to schedule tracking outbox relay', err));

  return { service, router, outboxService, outboxWorker };
}
