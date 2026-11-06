// Dev helper: fires the E-POD reminder for one load right now instead of waiting 30 minutes.
// Enqueues a zero-delay 'pod-reminder' job; the running server's load-reminders worker picks it up.
// The worker still skips it unless the load is `reached_unloading`, has a driver and no POD.
//
// Usage: npx ts-node -r reflect-metadata src/scripts/trigger-pod-reminder.ts <loadId>
import 'reflect-metadata';
import { Queue } from 'bullmq';
import { AppDataSource } from '../db/data-source';
import { LoadEntity } from '../modules/loads/entities/load.entity';
import { getQueueConnection, closeQueueConnection } from '../jobs/queue-connection';
import {
  LOAD_REMINDERS_QUEUE,
  POD_REMINDER_JOB,
} from '../modules/loads/alerts/load-alert-scheduler';

async function main(): Promise<void> {
  const loadId = process.argv[2];
  if (!loadId) throw new Error('Usage: trigger-pod-reminder.ts <loadId>');

  await AppDataSource.initialize();
  const load = await AppDataSource.getRepository(LoadEntity).findOne({ where: { id: loadId } });
  if (!load) throw new Error(`Load ${loadId} not found`);
  console.log(
    `Load ${load.code}: status=${load.status} driverId=${load.driverId ?? 'none'} pod=${load.podFileKey ?? 'none'}`,
  );
  if (load.status !== 'reached_unloading' || !load.driverId || load.podFileKey) {
    console.warn(
      'Not eligible (needs reached_unloading + driver + no POD) — the worker will skip it.',
    );
  }

  const queue = new Queue(LOAD_REMINDERS_QUEUE, { connection: getQueueConnection() });
  await queue.add(
    POD_REMINDER_JOB,
    { tenantId: load.tenantId, loadId: load.id, sequence: 0 },
    { jobId: `${POD_REMINDER_JOB}__${load.id}__manual_${Date.now()}` },
  );
  console.log('Queued. Check GET /v1/driver-portal/me/notifications in a few seconds.');
  await queue.close();
  await closeQueueConnection();
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
