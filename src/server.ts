import 'reflect-metadata';
import { createApp } from './app';
import { env } from './config/env';
import { buildContainer } from './composition-root';
import { AppDataSource } from './db/data-source';
import { redisManager } from './db/redis';
import { assertPermissionsSeeded } from './modules/roles/assert-permissions-seeded';

async function bootstrap() {
  await AppDataSource.initialize();
  await assertPermissionsSeeded(AppDataSource);
  await redisManager.connect();

  const container = buildContainer(AppDataSource);
  const app = createApp(container);

  app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
