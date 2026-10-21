import { JobsOptions } from 'bullmq';
import { JobQueue } from '../../../jobs/queue-registry';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditResourceType } from '../../audit/audit.types';
import { GstVerificationEntity } from './entities/gst-verification.entity';
import { GstVerificationService } from './gst.service';
import { GstRateGate } from './gst-rate-gate';

/** One queue for every background GSTIN check (customers, transporters): its limiter is the
 *  "one IDfy lookup per window" rule, so all record kinds share it. Job name = record kind. */
export const GST_VERIFICATION_QUEUE = 'gst-verification';

// Retries are for vendor hiccups only (network, IDfy 429/5xx, a slow task) — a register answer
// is final. Backoff starts at the 2-minute window since the limiter would hold the job anyway.
const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 120_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { count: 5000 },
};

export interface GstVerificationJobPayload {
  tenantId: string;
  recordId: string;
  actorId: string;
}

/** What one run decided. `rate_limited` tells the worker to park the job (Worker.rateLimit). */
export type GstVerificationJobResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'verified' | 'failed'; error: string | null }
  | { outcome: 'rate_limited'; retryInMs: number };

/** Thrown to make BullMQ retry the job with backoff (transient vendor error, attempts left). */
export class RetryableGstVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableGstVerificationError';
  }
}

/** The fields every GST-verified record shares. */
export interface GstTargetRecord {
  id: string;
  tenantId: string;
  name: string;
  gstin: string | null;
  gstVerificationStatus: string;
}

/** How one record kind (customer, transporter) is read and written by the background check. */
export interface GstVerificationTarget<R extends GstTargetRecord> {
  /** BullMQ job name, e.g. 'verify-customer'. */
  jobName: string;
  find(tenantId: string, id: string): Promise<R | null>;
  /** Columns for a verified register lookup (status, ids, registry name, address fill-ins…). */
  verifiedColumns(record: R, verified: GstVerificationEntity): Record<string, unknown>;
  /** Writes columns only if the record still has `gstin` and is still 'pending' — an edit made
   *  while the job ran wins. */
  updateIfPending(record: R, gstin: string, columns: Record<string, unknown>): Promise<void>;
  auditAction: AuditAction;
  resourceType: AuditResourceType;
}

const maskGstin = (gstin: string) => `${gstin.slice(0, 2)}*********${gstin.slice(-4)}`;

/**
 * Background GST verification for bulk-imported records. The import saves each GSTIN record as
 * 'pending' and enqueues one job per record (jobId = record id, so it's never queued twice). The
 * 'gst-verification' worker runs one job at a time under a 1-per-window limiter, and every run
 * also takes the GstRateGate slot it shares with the Verify button.
 */
export class GstBackgroundVerification<R extends GstTargetRecord> {
  constructor(
    private readonly target: GstVerificationTarget<R>,
    private readonly gstVerification: GstVerificationService,
    private readonly rateGate: GstRateGate,
    private readonly audit: AuditService,
    private readonly jobQueue: JobQueue,
  ) {}

  get jobName(): string {
    return this.target.jobName;
  }

  /** Fire-and-forget: a queue outage must never fail the import. The record stays 'pending'. */
  async enqueue(payload: GstVerificationJobPayload): Promise<boolean> {
    try {
      await this.jobQueue.enqueue(this.target.jobName, payload, {
        ...JOB_OPTIONS,
        jobId: payload.recordId,
      });
      return true;
    } catch (error) {
      console.error(
        `Failed to enqueue ${this.target.jobName} for record ${payload.recordId}`,
        error,
      );
      return false;
    }
  }

  /**
   * One job run. `attempt` is 1-based; on the last attempt a transient failure is recorded as
   * 'failed' instead of thrown. Throws RetryableGstVerificationError only to request a retry.
   */
  async process(
    payload: GstVerificationJobPayload,
    attempt: number,
    maxAttempts: number,
  ): Promise<GstVerificationJobResult> {
    const { tenantId, recordId, actorId } = payload;
    const record = await this.target.find(tenantId, recordId);
    if (!record?.gstin) return this.skip(recordId, 'deleted or has no GSTIN');
    // Edited in the meantime (GSTIN changed, verified from the drawer) — nothing left to do.
    if (record.gstVerificationStatus !== 'pending')
      return this.skip(recordId, `status is ${record.gstVerificationStatus}`);

    const { gstin } = record;
    if (!this.gstVerification.isConfigured()) {
      return this.finish(record, gstin, actorId, { failed: 'GST verification is not configured' });
    }

    const slot = await this.rateGate.tryAcquire();
    if (!slot.ok) {
      console.info(
        `[gst-verification] ${this.log(recordId)} slot busy, deferring ${slot.retryInMs}ms`,
      );
      return { outcome: 'rate_limited', retryInMs: slot.retryInMs };
    }

    const lookup = await this.gstVerification.verifyInBackground(tenantId, actorId, gstin);
    if (lookup.row.status === 'verified') {
      return this.finish(record, gstin, actorId, { verified: lookup.row });
    }
    const error = lookup.error ?? `GST lookup returned ${lookup.row.status}`;
    if (lookup.transient && attempt < maxAttempts) {
      console.warn(
        `[gst-verification] ${this.log(recordId)} gstin=${maskGstin(gstin)} attempt=${attempt}/${maxAttempts} transient: ${error}`,
      );
      throw new RetryableGstVerificationError(error);
    }
    return this.finish(record, gstin, actorId, { failed: error });
  }

  private log(recordId: string) {
    return `job=${this.target.jobName} record=${recordId}`;
  }

  private skip(recordId: string, reason: string): GstVerificationJobResult {
    console.info(`[gst-verification] ${this.log(recordId)} skipped: ${reason}`);
    return { outcome: 'skipped', reason };
  }

  private async finish(
    record: R,
    gstin: string,
    actorId: string,
    result: { verified: GstVerificationEntity } | { failed: string },
  ): Promise<GstVerificationJobResult> {
    const columns =
      'verified' in result
        ? this.target.verifiedColumns(record, result.verified)
        : { gstVerificationStatus: 'failed', gstVerificationError: result.failed.slice(0, 500) };
    await this.target.updateIfPending(record, gstin, columns);
    const outcome = 'verified' in result ? 'verified' : 'failed';
    const error = 'failed' in result ? result.failed : null;
    console.info(
      `[gst-verification] ${this.log(record.id)} gstin=${maskGstin(gstin)} outcome=${outcome}${error ? ` error="${error}"` : ''}`,
    );
    await this.audit.log({
      tenantId: record.tenantId,
      userId: actorId,
      action: this.target.auditAction,
      resourceType: this.target.resourceType,
      newData: { id: record.id, gstin, gstVerificationStatus: outcome, error },
    });
    return { outcome, error };
  }
}
