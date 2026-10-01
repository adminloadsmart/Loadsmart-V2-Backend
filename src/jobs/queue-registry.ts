import { Queue, JobsOptions } from 'bullmq';
import { getQueueConnection } from './queue-connection';

export interface JobQueue {
  enqueue(
    jobName: string,
    payload: unknown,
    options?: { delay?: number; jobId?: string },
  ): Promise<void>;
  // Removes a still-delayed/waiting job by its jobId — a no-op if it's already run, already
  // removed, or was never scheduled. Lets a caller reschedule a one-time delayed job (e.g. vehicle
  // compliance alerts) by cancelling the stale one before enqueuing the new one.
  cancel(jobId: string): Promise<void>;
}

// One BullMQ Queue instance per name, reused across calls — BullMQ recommends against creating a
// fresh Queue object per enqueue (each one opens its own Redis connections/listeners).
const queues = new Map<string, Queue>();

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  // Bounded, not unlimited — keeps a recent window of failed jobs around for post-mortem
  // inspection (e.g. via a BullMQ dashboard) without letting Redis grow without bound.
  removeOnFail: { count: 1000 },
};

/** Real, BullMQ-backed job queue (see modules/notifications for the first consumer). Safe to
 *  call more than once with the same `name` — returns the same underlying Queue. */
export function createJobQueue(name: string): JobQueue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getQueueConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  const resolvedQueue = queue;

  return {
    async enqueue(
      jobName: string,
      payload: unknown,
      options?: { delay?: number; jobId?: string },
    ): Promise<void> {
      await resolvedQueue.add(jobName, payload, options);
    },
    async cancel(jobId: string): Promise<void> {
      const job = await resolvedQueue.getJob(jobId);
      if (!job) return;
      // Only a still-pending job should be pulled — one that's already active/completed has
      // either already run or is currently running, and BullMQ's own state guards throw rather
      // than silently no-op if remove() is called on those states.
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting') {
        await job.remove();
      }
    },
  };
}

/** Called from server.ts's graceful shutdown, before closeQueueConnection(). */
export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
