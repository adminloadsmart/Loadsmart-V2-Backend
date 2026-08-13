import { env } from '../../config/env';

/**
 * Result of a driving-licence lookup against the Sarathi registry. `manual_review` covers "registry
 * says it doesn't recognise this licence", "IDfy isn't configured", and "the call/poll failed" — the
 * caller doesn't need to tell those apart, since all three fall back to the same manual-entry route.
 */
export interface SarathiDrivingLicenceResult {
  status: 'verified' | 'manual_review';
  holderName?: string;
  validUntil?: string;
  licenseClass?: string;
  licenseStatus?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  rawResponse?: Record<string, unknown>;
}

const TASK_TYPE = 'ind_driving_license';
const POLL_INTERVAL_MS = 1500;
// ~15s ceiling — IDfy's own sample completes in a few seconds, so this is generous, not tight.
const POLL_MAX_ATTEMPTS = 10;

interface IdfyCovDetail {
  category: string;
  cov: string;
  issue_date: string;
}

/** Only the fields this integration reads — IDfy returns others we don't use. */
interface IdfySourceOutput {
  status: string; // 'id_found' | 'id_not_found' | ...
  name: string | null;
  dl_status: string | null;
  nt_validity_to: string | null;
  t_validity_to: string | null;
  cov_details: IdfyCovDetail[] | null;
  address: string | null;
  city: string | null;
  [key: string]: unknown;
}

interface IdfyTask {
  status: string; // 'completed' | 'failed' | ...
  result?: { source_output: IdfySourceOutput };
}

/**
 * Wraps IDfy's `verify_with_source` DL check against the Sarathi registry. It's a submit-then-poll
 * API: the POST kicks off an async task and returns a request_id, then GET /tasks?request_id=... is
 * polled until the task completes. task_id/group_id are fixed values from env (this account's IDfy
 * workspace setup), not generated per call.
 */
export class SarathiClient {
  async lookupDrivingLicence(
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    if (!env.idfyApiKey || !env.idfyAccountId || !env.idfyTaskId || !env.idfyGroupId) {
      return { status: 'manual_review' };
    }

    try {
      const requestId = await this.submit(licenseNumber, dateOfBirth);
      const output = await this.poll(requestId);
      return this.mapResult(output);
    } catch {
      // Network error, non-2xx, unexpected shape, or poll timeout — all fall back to manual review
      // rather than surfacing a 500 to the "Add a driver" form.
      return { status: 'manual_review' };
    }
  }

  private async submit(licenseNumber: string, dateOfBirth: string): Promise<string> {
    const response = await fetch(
      `${env.idfyBaseUrl}/v3/tasks/async/verify_with_source/${TASK_TYPE}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          task_id: env.idfyTaskId,
          group_id: env.idfyGroupId,
          data: {
            id_number: licenseNumber,
            date_of_birth: dateOfBirth,
            advanced_details: { state_info: true, age_info: true },
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`IDfy submit failed with status ${response.status}`);
    }

    const body = (await response.json()) as { request_id: string };
    return body.request_id;
  }

  private async poll(requestId: string): Promise<IdfySourceOutput> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const response = await fetch(
        `${env.idfyBaseUrl}/v3/tasks?request_id=${encodeURIComponent(requestId)}`,
        { headers: this.headers() },
      );

      if (!response.ok) {
        throw new Error(`IDfy poll failed with status ${response.status}`);
      }

      const [task] = (await response.json()) as IdfyTask[];

      if (task?.status === 'completed' && task.result) {
        return task.result.source_output;
      }
      if (task && task.status !== 'in_progress' && task.status !== 'pending') {
        throw new Error(`IDfy task ended with unexpected status ${task.status}`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error('IDfy poll timed out');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'account-id': env.idfyAccountId!,
      'api-key': env.idfyApiKey!,
    };
  }

  private mapResult(output: IdfySourceOutput): SarathiDrivingLicenceResult {
    if (output.status !== 'id_found') {
      return { status: 'manual_review', rawResponse: output };
    }

    return {
      status: 'verified',
      holderName: output.name ?? undefined,
      // Non-transport validity is the general driving-licence validity; transport (commercial) is
      // the fallback for drivers who only hold that class.
      validUntil: output.nt_validity_to ?? output.t_validity_to ?? undefined,
      licenseClass: output.cov_details?.map((cov) => cov.cov).join(', ') || undefined,
      licenseStatus: output.dl_status ?? undefined,
      addressLine1: output.address ?? undefined,
      city: output.city ?? undefined,
      rawResponse: output,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
