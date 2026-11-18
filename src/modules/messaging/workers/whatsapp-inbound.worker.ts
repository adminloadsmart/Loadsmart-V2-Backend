import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import {
  INBOUND_JOB_NAMES,
  INBOUND_WORKER_CONCURRENCY,
  MESSAGING_QUEUES,
} from '../messaging.constants';
import {
  ApplyStatusJobPayload,
  InboundPipelineService,
  ProcessSenderJobPayload,
} from '../inbound/inbound-pipeline.service';

/**
 * In-process BullMQ worker for inbound WhatsApp (same pattern as the notifications worker).
 * A SenderBusyError is rethrown so BullMQ retries the job after the configured backoff.
 */
export function createWhatsappInboundWorker(pipeline: InboundPipelineService): Worker {
  return new Worker(
    MESSAGING_QUEUES.inbound,
    async (job: Job) => {
      if (job.name === INBOUND_JOB_NAMES.processSender) {
        await pipeline.processSender(job.data as ProcessSenderJobPayload);
        return;
      }
      if (job.name === INBOUND_JOB_NAMES.applyStatus) {
        await pipeline.applyStatus(job.data as ApplyStatusJobPayload);
        return;
      }
      throw new Error(`Unknown whatsapp-inbound job "${job.name}"`);
    },
    { connection: getQueueConnection(), concurrency: INBOUND_WORKER_CONCURRENCY },
  );
}
