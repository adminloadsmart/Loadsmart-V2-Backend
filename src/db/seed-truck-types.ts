// Seeds the fixed truck-type catalog — both the legacy name-only entries and the structured
// body/wheel/capacity configurations (Plan Dispatch v2.0 §6.6's Market Fleet picker) — into the
// global masters.truck_type_catalog table. Org admins pick from this catalog in the "Add truck
// type" modal (GET /truck-types/catalog, POST /truck-types/from-catalog) — it is not copied into
// any tenant automatically. Safe to re-run: only inserts names not already in the catalog.
//
// Run via `npm run seed:all` (src/db/seed.ts), which drives this and every other data seeder off
// one shared DataSource — this file has no standalone CLI entry point of its own.

import { DataSource } from 'typeorm';
import { TruckTypeCatalogRepository } from '../modules/masters/truck-type-catalog/truck-type-catalog.repository';
import { TruckTypeCatalogService } from '../modules/masters/truck-type-catalog/truck-type-catalog.service';

export async function seedTruckTypes(dataSource: DataSource): Promise<void> {
  const truckTypeCatalogService = new TruckTypeCatalogService(
    new TruckTypeCatalogRepository(dataSource),
  );
  await truckTypeCatalogService.seedDefaults(null);
  console.log('Truck type catalog seeded.');
}
