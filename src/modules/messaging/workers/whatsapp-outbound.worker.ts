import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import {
  MESSAGING_QUEUES,
  OUTBOUND_JOB_RETRY,
  OUTBOUND_SEND_RATE_PER_SECOND,
  OUTBOUND_LIMITER_WINDOW_MS,
} from '../messaging.constants';
import { OutboundJobPayload, OutboundMessageService } from '../outbound/outbound-message.service';

/**
 * In-process sender for queued WhatsApp messages. The BullMQ limiter keeps us under the provider's
 * throughput (Meta 80 msg/s → 50/s); retryable failures are retried, the last attempt records them.
 */
export function createWhatsappOutboundWorker(outbound: OutboundMessageService): Worker {
  return new Worker(
    MESSAGING_QUEUES.outbound,
    async (job: Job<OutboundJobPayload>) => {
      const attempts = job.opts.attempts ?? OUTBOUND_JOB_RETRY.attempts;
      await outbound.deliver(job.data, job.attemptsMade + 1 >= attempts);
    },
    {
      connection: getQueueConnection(),
      limiter: { max: OUTBOUND_SEND_RATE_PER_SECOND, duration: OUTBOUND_LIMITER_WINDOW_MS },
    },
  );
}
