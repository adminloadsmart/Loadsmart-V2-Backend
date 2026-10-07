import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../jobs/queue-connection';
import {
  DOCUMENT_VERIFICATION_QUEUE,
  OrganizationDocumentVerificationService,
} from '../organization-document-verification.service';

interface VerifyJobPayload {
  documentId: string;
}

/** BullMQ Worker for the 'org-document-verification' queue, started in-process like the
 *  notifications worker (see composition-root.ts's backgroundWorkers). */
export function createOrganizationDocumentVerificationWorker(
  service: OrganizationDocumentVerificationService,
): Worker {
  return new Worker<VerifyJobPayload>(
    DOCUMENT_VERIFICATION_QUEUE,
    async (job: Job<VerifyJobPayload>) => service.processDocument(job.data.documentId),
    { connection: getQueueConnection(), concurrency: 5 },
  );
}
