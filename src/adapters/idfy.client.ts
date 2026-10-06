import { env } from '../config/env';

/** A task as returned by `GET /v3/tasks?request_id=...` — only the fields callers read. */
export interface IdfyTask {
  status: string; // 'in_progress' | 'completed' | 'failed' | ...
  result?: { source_output?: Record<string, unknown> };
}

/** Result of an IDfy bank-account check. `verificationStatus` uses the driver_bank_details
 *  column's own vocabulary so callers can persist it as-is: 'pending' means "no verdict" (IDfy
 *  unconfigured, out of credits, timed out or failed) and leaves the row for manual review —
 *  never an implicit 'verified'. */
export interface BankAccountVerificationResult {
  verificationStatus: 'verified' | 'rejected' | 'pending';
  /** The account holder's name as the bank returned it. */
  nameAtBank?: string;
  /** IDfy request_id. */
  sourceReference?: string;
  rawResponse?: Record<string, unknown>;
}

/** Shapes a bank verification result into driver_bank_details columns. */
export function toBankVerificationColumns(result: BankAccountVerificationResult) {
  return {
    verificationStatus: result.verificationStatus,
    verifiedAt: result.verificationStatus === 'verified' ? new Date() : null,
    sourceReference: result.sourceReference ?? null,
    nameAtBank: result.nameAtBank ?? null,
    rawResponse: result.rawResponse ?? null,
  };
}

const BANK_TASK_TYPE = 'validate_bank_account';
const BANK_POLL_INTERVAL_MS = 1500;
// ~15s ceiling, same budget as SarathiClient — penny-less usually answers in a few seconds.
const BANK_POLL_MAX_ATTEMPTS = 10;
const IN_PROGRESS_STATUSES = new Set(['in_progress', 'pending', 'queued']);

/**
 * Generic wrapper over IDfy's async `verify_with_source` tasks: submit returns a request_id,
 * getTask reads its current state once. Those two never loop — the caller (a BullMQ worker for
 * organization documents) owns the waiting/retrying. verifyBankAccount is the exception: it
 * submits and polls inside the request, like SarathiClient. task_id/group_id are the
 * fixed values from env, same as SarathiClient.
 */
export class IdfyClient {
  isConfigured(): boolean {
    return Boolean(env.idfyApiKey && env.idfyAccountId && env.idfyTaskId && env.idfyGroupId);
  }

  async submit(taskType: string, data: Record<string, unknown>): Promise<string> {
    const response = await fetch(
      `${env.idfyBaseUrl}/v3/tasks/async/verify_with_source/${taskType}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ task_id: env.idfyTaskId, group_id: env.idfyGroupId, data }),
      },
    );
    if (!response.ok) {
      throw new Error(`IDfy submit (${taskType}) failed with status ${response.status}`);
    }
    const body = (await response.json()) as { request_id?: string };
    if (!body.request_id) {
      throw new Error(`IDfy submit (${taskType}) returned no request_id`);
    }
    return body.request_id;
  }

  async getTask(requestId: string): Promise<IdfyTask | undefined> {
    const response = await fetch(
      `${env.idfyBaseUrl}/v3/tasks?request_id=${encodeURIComponent(requestId)}`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(`IDfy poll failed with status ${response.status}`);
    }
    // An unknown request_id comes back as 200 `{ message }` rather than an array.
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body[0] as IdfyTask | undefined) : undefined;
  }

  /**
   * IDfy `validate_bank_account` — `nf_verification: true` tries penny-less first and only falls
   * back to a Rs 1 penny drop. Polls inside the request (see BANK_POLL_*).
   */
  async verifyBankAccount(
    accountNumber: string,
    ifsc: string,
  ): Promise<BankAccountVerificationResult> {
    if (!this.isConfigured()) {
      return { verificationStatus: 'pending' };
    }

    try {
      const requestId = await this.submit(BANK_TASK_TYPE, {
        bank_account_no: accountNumber,
        bank_ifsc_code: ifsc,
        nf_verification: true,
      });

      for (let attempt = 0; attempt < BANK_POLL_MAX_ATTEMPTS; attempt++) {
        const task = await this.getTask(requestId);
        if (task && !IN_PROGRESS_STATUSES.has(task.status)) {
          const output = task.result?.source_output;
          if (task.status !== 'completed' || !output) {
            // Failed task (e.g. credits exhausted) is not a verdict on the account.
            return { verificationStatus: 'pending', sourceReference: requestId };
          }
          const exists = output.account_exists === 'YES' || output.status === 'id_found';
          return {
            verificationStatus: exists ? 'verified' : 'rejected',
            nameAtBank: typeof output.name_at_bank === 'string' ? output.name_at_bank : undefined,
            sourceReference: requestId,
            rawResponse: output,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, BANK_POLL_INTERVAL_MS));
      }
      return { verificationStatus: 'pending', sourceReference: requestId };
    } catch {
      // Network error / non-2xx — no verdict, leave for manual review.
      return { verificationStatus: 'pending' };
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'account-id': env.idfyAccountId!,
      'api-key': env.idfyApiKey!,
    };
  }
}
