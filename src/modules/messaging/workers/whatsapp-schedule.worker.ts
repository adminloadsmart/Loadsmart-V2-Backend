import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import { JobQueue } from '../../../jobs/queue-registry';
import {
  BIDS_ROLLUP_JOB,
  MEMO_REMINDER_JOB,
  MESSAGING_QUEUES,
  ORIGINAL_POD_FOLLOW_UP_CRON,
  ORIGINAL_POD_FOLLOW_UP_JOB,
  ORIGINAL_POD_FOLLOW_UP_TIME_ZONE,
} from '../messaging.constants';
import { LoadPartyWhatsapp } from '../integration/load-party-whatsapp';
import { BidsRollupJob, MemoReminderJob } from '../integration/load-notices.interface';

/** Registers the daily original POD follow-up (idempotent — safe on every boot / instance). */
export async function scheduleWhatsappFollowUps(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(
    ORIGINAL_POD_FOLLOW_UP_JOB,
    ORIGINAL_POD_FOLLOW_UP_CRON,
    ORIGINAL_POD_FOLLOW_UP_TIME_ZONE,
    ORIGINAL_POD_FOLLOW_UP_JOB,
  );
}

/** Runs the scheduled WhatsApp jobs: the daily original POD reminders and penalty notices, and the
 *  delayed bids roll-up to the shipper (LS_N_0103), and the load memo reminder 20 minutes before
 *  it expires (LS_N_0069). */
export function createWhatsappScheduleWorker(notices: LoadPartyWhatsapp): Worker {
  return new Worker(
    MESSAGING_QUEUES.schedules,
    async (job: Job) => {
      if (job.name === ORIGINAL_POD_FOLLOW_UP_JOB) {
        await notices.runOriginalPodFollowUps();
        return;
      }
      if (job.name === BIDS_ROLLUP_JOB) {
        await notices.runBidsRollup(job.data as BidsRollupJob);
        return;
      }
      if (job.name === MEMO_REMINDER_JOB) {
        await notices.runMemoReminder(job.data as MemoReminderJob);
        return;
      }
      throw new Error(`Unknown whatsapp-schedules job "${job.name}"`);
    },
    { connection: getQueueConnection() },
  );
}
