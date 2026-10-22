import { Job, Worker } from 'bullmq';
import { env } from '../../../../config/env';
import { getQueueConnection } from '../../../../jobs/queue-connection';
import {
  VAHAN_VERIFICATION_QUEUE,
  VahanVerificationJobPayload,
  VehicleVahanVerificationService,
} from '../vehicle-vahan-verification.service';

/**
 * BullMQ Worker for the 'vahan-verification' queue, started in-process like the other workers
 * (composition-root.ts's backgroundWorkers). One job at a time under a limiter kept in Redis per
 * queue, so "one ULIP lookup per window" holds across every API instance; retries pass through it.
 */
export function createVehicleVahanVerificationWorker(
  service: VehicleVahanVerificationService,
): Worker {
  const worker = new Worker<VahanVerificationJobPayload>(
    VAHAN_VERIFICATION_QUEUE,
    async (job: Job<VahanVerificationJobPayload>) =>
      service.process(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1),
    {
      connection: getQueueConnection(),
      concurrency: 1,
      limiter: { max: 1, duration: env.vahanVerificationRateLimitMs },
    },
  );
  worker.on('failed', (job, error) => {
    if (job)
      console.error(
        `[vahan-verification] job ${job.id} attempt ${job.attemptsMade} failed: ${error.message}`,
      );
  });
  return worker;
}
