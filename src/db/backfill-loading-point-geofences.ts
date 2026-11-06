import 'reflect-metadata';
import { IsNull, Not } from 'typeorm';
import { AppDataSource } from './data-source';
import { LoadingPointEntity } from '../modules/masters/loading-point/entities/loading-point.entity';
import { GeofenceRepository } from '../modules/geofences/geofence.repository';
import { LoadingPointGeofenceSync } from '../modules/masters/loading-point/loading-point-geofence.sync';

/** One-off, idempotent: gives every existing loading point that has a pin a linked geofence. */
async function main() {
  const dataSource = await AppDataSource.initialize();
  try {
    const sync = new LoadingPointGeofenceSync(new GeofenceRepository(dataSource));
    const points = await dataSource.getRepository(LoadingPointEntity).find({
      where: { latitude: Not(IsNull()), longitude: Not(IsNull()) },
    });
    for (const point of points) await sync.upsert(point, point.createdBy);
    console.log(`Synced geofences for ${points.length} loading point(s)`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
