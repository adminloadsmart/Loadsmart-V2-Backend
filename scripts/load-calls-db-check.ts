/**
 * Local check of Log a call (task 5) on real Postgres: logs a shipper call and a Loadsmart call on
 * one real load through the real repository, reads both views, closes the reminder, checks the
 * CALL_LOGGED timeline entry, then deletes its rows. No notification is sent (no triggers).
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/load-calls-db-check.ts
 */
import { AppDataSource } from '../src/db/data-source';
import { LoadEntity } from '../src/modules/loads/entities/load.entity';
import { LoadActivityEntity } from '../src/modules/loads/entities/load-activity.entity';
import { LoadActivityRepository } from '../src/modules/loads/activity/load-activity.repository';
import { LoadActivityService } from '../src/modules/loads/activity/load-activity.service';
import { LoadCallEntity } from '../src/modules/loads/calls/load-call.entity';
import { LoadCallRepository } from '../src/modules/loads/calls/load-call.repository';
import { LoadCallService } from '../src/modules/loads/calls/load-call.service';
import { UserEntity } from '../src/modules/auth/entities/user.entity';
import type { AuthService } from '../src/modules/auth/auth.service';

async function main() {
  await AppDataSource.initialize();
  const load = await AppDataSource.getRepository(LoadEntity).findOne({
    where: {},
    order: { createdAt: 'DESC' },
  });
  const user = await AppDataSource.getRepository(UserEntity).findOne({
    where: { tenantId: load?.tenantId },
  });
  if (!load || !user) throw new Error('need a load and a user of its tenant in the local DB');
  const service = new LoadCallService(
    new LoadCallRepository(AppDataSource),
    new LoadActivityService(new LoadActivityRepository(AppDataSource), {} as AuthService),
  );
  const created: string[] = [];
  const checks: [string, boolean, string][] = [];
  try {
    const reminderAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const shipperCall = await service.logShipperCall(load.tenantId, user.id, load.id, {
      parties: [{ role: 'driver', name: 'Smoke Driver' }],
      notes: 'smoke: truck at plant by 4 pm',
      outcome: 'picked_up',
    });
    created.push(shipperCall.id);
    const opsCall = await service.logLoadsmartCall(user.id, load.id, 'placement', {
      parties: [{ role: 'broker' }, { role: 'trucker_sales' }],
      notes: 'smoke: rate offered',
      outcome: 'price',
      price: 41000,
      reminderAt,
    });
    created.push(opsCall.id);
    const shipperView = await service.listForShipper(load.tenantId, load.id);
    const opsView = await service.listForLoadsmart(load.id);
    checks.push([
      'shipper view hides the Loadsmart call',
      shipperView.some((call) => call.id === shipperCall.id) &&
        !shipperView.some((call) => call.id === opsCall.id),
      `${shipperView.length}`,
    ]);
    checks.push([
      'ops view has both, with caller name and price',
      opsView.some((call) => call.id === opsCall.id && call.price === '41000.00') &&
        opsView.some((call) => call.id === shipperCall.id && call.calledBy.id === user.id),
      `${opsCall.calledBy.name}`,
    ]);
    const reminders = await service.myReminders(user.id);
    checks.push([
      'reminder queued for the caller, not due yet',
      reminders.some(
        (reminder) =>
          reminder.id === opsCall.id && !reminder.isDue && reminder.loadCode === load.code,
      ),
      String(reminders.length),
    ]);
    const closed = await service.markReminderDone(user.id, opsCall.id);
    checks.push([
      'reminder closed and no longer open',
      Boolean(closed.reminderDoneAt) &&
        (await service.openReminder(opsCall.id, reminderAt)) === null,
      closed.reminderDoneAt ?? '',
    ]);
    const activities = await AppDataSource.getRepository(LoadActivityEntity).count({
      where: { loadId: load.id, action: 'CALL_LOGGED' },
    });
    checks.push(['CALL_LOGGED on the load timeline', activities >= 2, String(activities)]);
  } finally {
    if (created.length) {
      await AppDataSource.getRepository(LoadCallEntity).delete(created);
      await AppDataSource.getRepository(LoadActivityEntity)
        .createQueryBuilder()
        .delete()
        .where('load_id = :loadId', { loadId: load.id })
        .andWhere('action = :action', { action: 'CALL_LOGGED' })
        .andWhere("metadata->>'callId' IN (:...ids)", { ids: created })
        .execute();
    }
  }
  for (const [name, passed, detail] of checks)
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  await AppDataSource.destroy();
  process.exit(checks.every(([, passed]) => passed) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
