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
  TRACKING_EVENTS_CONSUME_JOB,
} from './workers/tracking-outbox.worker';
import { TrackingEventsConsumer } from './tracking-events.consumer';
import { NotifyByType } from '../notifications/notify-by-type';

// How often the outbox relay publishes changes to the loadsmart-tracking service.
const OUTBOX_RELAY_EVERY_MS = 2000;
// How often alerts from the tracking service are turned into notifications.
const EVENTS_CONSUME_EVERY_MS = 3000;

export function createTrackingModule(dataSource: DataSource, deps: { notifyByType: NotifyByType }) {
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
  // The tracking service's alerts → this backend's notifications (push/SMS/… per org preferences).
  const eventsConsumer = new TrackingEventsConsumer(
    dataSource,
    getQueueConnection,
    deps.notifyByType,
  );
  const outboxWorker: Worker = createTrackingOutboxWorker(outboxService, eventsConsumer);
  upsertRepeatingJob(
    TRACKING_OUTBOX_QUEUE,
    'tracking-outbox-relay',
    OUTBOX_RELAY_EVERY_MS,
    TRACKING_OUTBOX_RELAY_JOB,
  ).catch((err) => console.error('Failed to schedule tracking outbox relay', err));
  upsertRepeatingJob(
    TRACKING_OUTBOX_QUEUE,
    'tracking-events-consume',
    EVENTS_CONSUME_EVERY_MS,
    TRACKING_EVENTS_CONSUME_JOB,
  ).catch((err) => console.error('Failed to schedule tracking events consumer', err));

  return { service, router, outboxService, outboxWorker };
}
