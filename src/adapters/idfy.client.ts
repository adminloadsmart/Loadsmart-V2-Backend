import { env } from '../config/env';

/** A task as returned by `GET /v3/tasks?request_id=...` — only the fields callers read. */
export interface IdfyTask {
  status: string; // 'in_progress' | 'completed' | 'failed' | ...
  result?: { source_output?: Record<string, unknown> };
}

/**
 * Generic wrapper over IDfy's async `verify_with_source` tasks: submit returns a request_id,
 * getTask reads its current state once. Unlike SarathiClient it never loops — the caller (a
 * BullMQ worker for organization documents) owns the waiting/retrying. task_id/group_id are the
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
    const [task] = (await response.json()) as IdfyTask[];
    return task;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'account-id': env.idfyAccountId!,
      'api-key': env.idfyApiKey!,
    };
  }
}
