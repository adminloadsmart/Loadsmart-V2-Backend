// Seeds the notification_types catalog FROM the in-code catalog (see
// modules/notifications/catalog/notification-catalog.ts) — the TS catalog stays the single source
// of truth for a notification type's label/description/available+default channels; this just
// mirrors it into a queryable table for the notification-preferences settings screen. Safe to re-run: each
// type is upserted by its unique `key`, same find-or-create-then-update-in-place shape as
// seed-roles.ts. Not bootstrap-critical (nothing depends on this table existing before other core
// actions, unlike roles) — same "part of the shared seed:all run" treatment as seed-truck-types.ts.
//
// Run via `npm run seed:all` (src/db/seed.ts), which drives this and every other data seeder off
// one shared DataSource — this file has no standalone CLI entry point of its own.

import { DataSource } from 'typeorm';
import { NotificationTypeEntity } from '../modules/notifications/entities/notification-type.entity';
import { NOTIFICATION_CATALOG } from '../modules/notifications/catalog/notification-catalog';

export async function seedNotificationTypes(dataSource: DataSource): Promise<void> {
  const typeRepo = dataSource.getRepository(NotificationTypeEntity);

  for (const [key, definition] of Object.entries(NOTIFICATION_CATALOG)) {
    const existing = await typeRepo.findOneBy({ key });
    if (!existing) {
      await typeRepo.save(
        typeRepo.create({
          key,
          label: definition.label,
          description: definition.description ?? null,
          channels: definition.channels,
          defaultChannels: definition.defaultChannels,
        }),
      );
      console.log(`created notification type ${key}`);
    } else {
      existing.label = definition.label;
      existing.description = definition.description ?? null;
      existing.channels = definition.channels;
      existing.defaultChannels = definition.defaultChannels;
      await typeRepo.save(existing);
      console.log(`updated notification type ${key}`);
    }
  }

  console.log('Notification types seeded.');
}
