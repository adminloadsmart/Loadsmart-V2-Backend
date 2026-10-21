import { Job, Worker } from 'bullmq';
import { env } from '../../../../config/env';
import { getQueueConnection } from '../../../../jobs/queue-connection';
import {
  GST_VERIFICATION_QUEUE,
  GstBackgroundVerification,
  GstTargetRecord,
  GstVerificationJobPayload,
} from '../gst-background-verification';

/** Jobs queued before transporters joined the queue carry `customerId` instead of `recordId`. */
type JobData = GstVerificationJobPayload & { customerId?: string };

/**
 * BullMQ Worker for the 'gst-verification' queue, started in-process like the other workers (see
 * composition-root.ts's backgroundWorkers). Every record kind (verify-customer,
 * verify-transporter) runs here, so the limiter — kept in Redis per queue — holds "one lookup per
 * window" across all kinds and every API instance; retries pass through it too. When the Verify
 * button took the shared slot first, the job is parked for the slot's remaining time without
 * spending an attempt (Worker.RateLimitError).
 */
export function createGstVerificationWorker(
  handlers: GstBackgroundVerification<GstTargetRecord>[],
): Worker {
  const byJobName = new Map(handlers.map((handler) => [handler.jobName, handler]));
  const worker: Worker<JobData> = new Worker<JobData>(
    GST_VERIFICATION_QUEUE,
    async (job: Job<JobData>) => {
      const handler = byJobName.get(job.name);
      if (!handler) throw new Error(`No GST verification handler for job "${job.name}"`);
      const { tenantId, actorId } = job.data;
      const recordId = job.data.recordId ?? job.data.customerId;
      const result = await handler.process(
        { tenantId, actorId, recordId },
        job.attemptsMade + 1,
        job.opts.attempts ?? 1,
      );
      if (result.outcome === 'rate_limited') {
        await worker.rateLimit(result.retryInMs);
        throw Worker.RateLimitError();
      }
      return result;
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
      limiter: { max: 1, duration: env.gstVerificationRateLimitMs },
    },
  );
  worker.on('failed', (job, error) => {
    if (job)
      console.error(
        `[gst-verification] job ${job.name}/${job.id} attempt ${job.attemptsMade} failed: ${error.message}`,
      );
  });
  return worker;
}
