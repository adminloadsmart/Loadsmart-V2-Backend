import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { getQueueConnection } from '../../jobs/queue-connection';
import { upsertRepeatingJob } from '../../jobs/queue-registry';
import { NotifyByType } from '../notifications/notify-by-type';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { createTrackingRoutes } from './tracking.routes';
import { TrackingEventsConsumer } from './tracking-events.consumer';
import {
  createTrackingEventsWorker,
  TRACKING_EVENTS_CONSUME_JOB,
  TRACKING_EVENTS_QUEUE,
} from './workers/tracking-events.worker';

// How often alerts from the loadsmart-tracking service are turned into notifications.
const EVENTS_CONSUME_EVERY_MS = 3000;

export function createTrackingModule(dataSource: DataSource, deps: { notifyByType: NotifyByType }) {
  const repository = new TrackingRepository(dataSource);
  const service = new TrackingService(repository);
  const controller = new TrackingController(service);
  const router = createTrackingRoutes(controller);

  // The tracking service's alerts (stream `tracking.events`) → this backend's notifications
  // (push/SMS/… per org preferences). The tracking service reads loads/vehicles straight from
  // this database, so nothing needs to be published to it.
  const eventsConsumer = new TrackingEventsConsumer(
    dataSource,
    getQueueConnection,
    deps.notifyByType,
  );
  const eventsWorker: Worker = createTrackingEventsWorker(eventsConsumer);
  upsertRepeatingJob(
    TRACKING_EVENTS_QUEUE,
    'tracking-events-consume',
    EVENTS_CONSUME_EVERY_MS,
    TRACKING_EVENTS_CONSUME_JOB,
  ).catch((err) => console.error('Failed to schedule tracking events consumer', err));

  return { service, router, eventsWorker };
}
