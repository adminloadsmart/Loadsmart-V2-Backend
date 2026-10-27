import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { LoadRepository } from '../load.repository';
import { LOAD_REMINDERS_QUEUE, POD_REMINDER_JOB } from '../alerts/load-alert-scheduler';
import { processPodReminder } from '../alerts/pod-reminder';
import { PodReminderJobPayload, DriverTripNotifier } from '../utils/load-alert.interface';

/** BullMQ worker for the 'load-reminders' queue — started in-process with the other workers (see
 *  composition-root.ts's backgroundWorkers). */
export function createLoadRemindersWorker(
  loadRepository: LoadRepository,
  notifier: DriverTripNotifier,
): Worker {
  const worker = new Worker<PodReminderJobPayload>(
    LOAD_REMINDERS_QUEUE,
    async (job: Job<PodReminderJobPayload>) => {
      if (job.name !== POD_REMINDER_JOB) throw new Error(`Unknown load reminder "${job.name}"`);
      return processPodReminder(job.data, loadRepository, notifier);
    },
    { connection: getQueueConnection(), concurrency: 5 },
  );
  worker.on('failed', (job, error) => {
    if (job) console.error(`[load-reminders] job ${job.name}/${job.id} failed: ${error.message}`);
  });
  return worker;
}
