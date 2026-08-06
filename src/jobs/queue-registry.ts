export interface JobQueue {
  enqueue(jobName: string, payload: unknown): Promise<void>;
}

// TODO: back this with a real queue (BullMQ) once a backend is chosen.
export function createJobQueue(_name: string): JobQueue {
  return {
    async enqueue() {
      // no-op placeholder
    },
  };
}
