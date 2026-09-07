import 'reflect-metadata';
import { createApp } from './app';
import { env } from './config/env';
import { buildContainer } from './composition-root';
import { AppDataSource } from './db/data-source';
import { redisManager } from './db/redis';
import { assertPermissionsSeeded } from './modules/roles/assert-permissions-seeded';
import { closeAllQueues } from './jobs/queue-registry';
import { closeQueueConnection } from './jobs/queue-connection';

async function bootstrap() {
  await AppDataSource.initialize();
  await assertPermissionsSeeded(AppDataSource);
  await redisManager.connect();

  const container = buildContainer(AppDataSource);
  const app = createApp(container);

  const server = app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });

  // No graceful shutdown existed before the in-process BullMQ worker(s) below — without this, a
  // pm2 restart mid-deploy could kill a job after its channel.send() succeeded but before the
  // delivery row was updated, and a naive retry could double-send.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    try {
      // worker.close() waits for any in-flight job to finish before resolving.
      await Promise.all(container.backgroundWorkers.map((worker) => worker.close()));
      await closeAllQueues();
      await closeQueueConnection();
    } catch (err) {
      console.error('Error during graceful shutdown', err);
    } finally {
      server.close(() => process.exit(0));
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
