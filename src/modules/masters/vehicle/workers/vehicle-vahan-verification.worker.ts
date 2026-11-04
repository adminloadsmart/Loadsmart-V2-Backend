import { DelayedError, Job, Worker } from 'bullmq';
import { env } from '../../../../config/env';
import { getQueueConnection } from '../../../../jobs/queue-connection';
import { VahanIpRateGate } from '../vahan-ip-rate-gate';
import {
  VAHAN_VERIFICATION_QUEUE,
  VahanVerificationJobPayload,
  VehicleVahanVerificationService,
} from '../vehicle-vahan-verification.service';

/**
 * BullMQ Worker for the 'vahan-verification' queue, started in-process like the other workers
 * (composition-root.ts's backgroundWorkers). Each importer IP is its own lane: a job first takes
 * that IP's slot in VahanIpRateGate (kept in Redis, so "one ULIP lookup per window per IP" holds
 * across every API instance). A job whose lane is busy is moved back to delayed until the slot
 * frees — that doesn't count as an attempt — so other IPs' jobs keep running alongside it.
 */
export function createVehicleVahanVerificationWorker(
  service: VehicleVahanVerificationService,
  gate: VahanIpRateGate,
): Worker {
  const worker = new Worker<VahanVerificationJobPayload>(
    VAHAN_VERIFICATION_QUEUE,
    async (job: Job<VahanVerificationJobPayload>, token?: string) => {
      const slot = await gate.tryAcquire(job.data.clientIp ?? 'unknown');
      if (!slot.ok) {
        await job.moveToDelayed(Date.now() + slot.retryInMs, token);
        throw new DelayedError();
      }
      return service.process(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1);
    },
    {
      connection: getQueueConnection(),
      concurrency: env.vahanVerificationConcurrency,
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
