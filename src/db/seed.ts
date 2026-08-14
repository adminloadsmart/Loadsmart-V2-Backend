// Single entry point for one-off data seeders (reference/master data, not the bootstrap-critical
// roles/platform-admin scripts — those stay standalone since CI's deploy.yml invokes their
// compiled dist/*.js directly, and platform-admin requires its own BOOTSTRAP_ADMIN_* env vars).
// Add a new seeder by exporting an async function from its own db/seed-*.ts (taking the shared
// DataSource, no init/destroy of its own) and calling it below — not a new npm script.
//
// Usage: npm run seed

import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { seedTruckTypes } from './seed-truck-types';

async function seedAll(): Promise<void> {
  const dataSource = await AppDataSource.initialize();

  try {
    await seedTruckTypes(dataSource);
  } finally {
    await dataSource.destroy();
  }

  console.log('Seed complete.');
}

seedAll().catch((error) => {
  console.error(error);
  process.exit(1);
});
