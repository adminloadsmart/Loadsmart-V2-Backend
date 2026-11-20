// One-off backfill: loads that are still on the road but tracked by SIM / FASTag / nothing, whose
// driver has since logged into the app, are moved to `driver_app` — the same switch that now
// happens on every driver login (loads/core/tracking-source.hook.ts), applied to the loads that
// were already in that state before it shipped. Idempotent; safe to re-run.
//
// Dry run by default (lists what would change). Pass APPLY=1 to write.
//
// Usage:
//   npm run backfill:driver-tracking-source
//   APPLY=1 npm run backfill:driver-tracking-source

import 'reflect-metadata';
import { In, IsNull } from 'typeorm';
import { AppDataSource } from './data-source';
import { LoadEntity } from '../modules/loads/entities/load.entity';
import { LoadRepository } from '../modules/loads/core/load.repository';
import {
  createDriverTrackingReevaluator,
  createTrackingSourceResolver,
} from '../modules/loads/core/tracking-source.hook';
import { ON_ROAD_LOAD_STATUSES } from '../modules/loads/utils/loads.types';

async function run(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const dataSource = await AppDataSource.initialize();
  try {
    const loads = dataSource.getRepository(LoadEntity);
    const stale = await loads.find({
      where: [
        { status: In([...ON_ROAD_LOAD_STATUSES]), trackingSource: In(['sim', 'fastag']) },
        { status: In([...ON_ROAD_LOAD_STATUSES]), trackingSource: IsNull() },
      ],
    });
    const withDriver = stale.filter((load) => load.driverId && load.podStatus !== 'accepted');
    console.log(`${withDriver.length} on-road load(s) tracked by SIM / FASTag / nothing.`);

    if (!apply) {
      const resolveSource = createTrackingSourceResolver(dataSource);
      for (const load of withDriver) {
        if ((await resolveSource(load)) === 'driver_app') {
          console.log(`would switch ${load.id} (${load.trackingSource ?? 'none'} -> driver_app)`);
        }
      }
      console.log('Dry run — set APPLY=1 to write.');
      return;
    }

    const reevaluate = createDriverTrackingReevaluator(dataSource, new LoadRepository(dataSource));
    let switched = 0;
    for (const driverId of new Set(withDriver.map((load) => load.driverId as string))) {
      switched += (await reevaluate(driverId)).length;
    }
    console.log(`Switched ${switched} load(s) to driver_app.`);
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
