import { MigrationInterface, QueryRunner } from 'typeorm';

/** [name, body_type, wheel_configuration, capacity_tons] — a snapshot of the client's truck-type
 *  list (TRUCK_TYPE_CATALOG_CONFIGURATIONS as of this migration), kept inline so this migration
 *  does the same thing even if the picker table changes later. */
type CatalogRow = [string, string, number, number];

const NEW_CATALOG: readonly CatalogRow[] = [
  ['LCV Open Body · 4 tyre · 1.5T · 8-10ft', 'lcv_open_body', 4, 1.5],
  ['LCV Open Body · 4 tyre · 2T · 10-12ft', 'lcv_open_body', 4, 2],
  ['LCV Open Body · 6 tyre · 3.5T · 14ft', 'lcv_open_body', 6, 3.5],
  ['LCV Open Body · 6 tyre · 4T · 14ft', 'lcv_open_body', 6, 4],
  ['LCV Open Body · 6 tyre · 4T · 17ft', 'lcv_open_body', 6, 4],
  ['LCV Open Body · 6 tyre · 4.5T · 17ft', 'lcv_open_body', 6, 4.5],
  ['LCV Open Body · 6 tyre · 6T · 17ft', 'lcv_open_body', 6, 6],
  ['LCV Open Body · 6 tyre · 6T · 19ft', 'lcv_open_body', 6, 6],
  ['LCV Open Body · 6 tyre · 6T · 20ft', 'lcv_open_body', 6, 6],
  ['LCV Open Body · 6 tyre · 6T · 22ft', 'lcv_open_body', 6, 6],
  ['LCV Open Body · 6 tyre · 6T · 24ft', 'lcv_open_body', 6, 6],
  ['LCV Open Body · 6 tyre · 6.5T · 19ft', 'lcv_open_body', 6, 6.5],
  ['LCV Open Body · 6 tyre · 7T · 19ft', 'lcv_open_body', 6, 7],
  ['LCV Open Body · 6 tyre · 7T · 20ft', 'lcv_open_body', 6, 7],
  ['LCV Open Body · 6 tyre · 7T · 22ft', 'lcv_open_body', 6, 7],
  ['LCV Open Body · 6 tyre · 7T · 24ft', 'lcv_open_body', 6, 7],
  ['LCV Open Body · 6 tyre · 7.5T · 20ft', 'lcv_open_body', 6, 7.5],
  ['LCV Open Body · 6 tyre · 7.5T · 22ft', 'lcv_open_body', 6, 7.5],
  ['LCV Open Body · 6 tyre · 7.5T · 24ft', 'lcv_open_body', 6, 7.5],
  ['Open Body · 6 tyre · 8T · 20ft', 'open_body', 6, 8],
  ['Open Body · 6 tyre · 8T · 22ft', 'open_body', 6, 8],
  ['Open Body · 6 tyre · 9T · 22ft', 'open_body', 6, 9],
  ['Open Body · 6 tyre · 9T · 24ft', 'open_body', 6, 9],
  ['Open Body · 6 tyre · 10T · 20ft', 'open_body', 6, 10],
  ['Open Body · 6 tyre · 10T · 22ft', 'open_body', 6, 10],
  ['Open Body · 6 tyre · 10T · 24ft', 'open_body', 6, 10],
  ['Open Body · 6 tyre · 12T · 20ft', 'open_body', 6, 12],
  ['Open Body · 6 tyre · 12T · 22ft', 'open_body', 6, 12],
  ['Open Body · 6 tyre · 12T · 24ft', 'open_body', 6, 12],
  ['Open Body · 10 tyre · 15T · 22ft', 'open_body', 10, 15],
  ['Open Body · 10 tyre · 16T · 22ft', 'open_body', 10, 16],
  ['Open Body · 10 tyre · 18T · 24ft', 'open_body', 10, 18],
  ['Open Body · 12 tyre · 25T · 24ft', 'open_body', 12, 25],
  ['Open Body · 12 tyre · 25T · 25ft', 'open_body', 12, 25],
  ['Open Body · 12 tyre · 25T · 26ft', 'open_body', 12, 25],
  ['Open Body · 12 tyre · 25T · 28ft', 'open_body', 12, 25],
  ['Open Body · 14 tyre · 30T · 28ft', 'open_body', 14, 30],
  ['Open Body · 14 tyre · 30T · 30ft', 'open_body', 14, 30],
  ['Open Body · 14 tyre · 30T · 32ft', 'open_body', 14, 30],
  ['Open Body · 16 tyre · 35T · 30ft', 'open_body', 16, 35],
  ['Open Body · 16 tyre · 35T · 32ft', 'open_body', 16, 35],
  ['Open Body · 18 tyre · 35T · 30ft', 'open_body', 18, 35],
  ['Open Body · 18 tyre · 42T · 32ft', 'open_body', 18, 42],
  ['LCV Container · 4 tyre · 1.5T · 8-10ft', 'lcv_container', 4, 1.5],
  ['LCV Container · 4 tyre · 2T · 10-12ft', 'lcv_container', 4, 2],
  ['LCV Container · 4 tyre · 3.5T · 14ft', 'lcv_container', 4, 3.5],
  ['LCV Container · 6 tyre · 4T · 14ft', 'lcv_container', 6, 4],
  ['LCV Container · 6 tyre · 4T · 17ft', 'lcv_container', 6, 4],
  ['LCV Container · 6 tyre · 4.5T · 17ft', 'lcv_container', 6, 4.5],
  ['LCV Container · 6 tyre · 6T · 17ft', 'lcv_container', 6, 6],
  ['LCV Container · 6 tyre · 6T · 19ft', 'lcv_container', 6, 6],
  ['LCV Container · 6 tyre · 6T · 20ft', 'lcv_container', 6, 6],
  ['LCV Container · 6 tyre · 6T · 22ft', 'lcv_container', 6, 6],
  ['LCV Container · 6 tyre · 6T · 24ft', 'lcv_container', 6, 6],
  ['LCV Container · 6 tyre · 6.5T · 19ft', 'lcv_container', 6, 6.5],
  ['LCV Container · 6 tyre · 7T · 19ft', 'lcv_container', 6, 7],
  ['LCV Container · 6 tyre · 7T · 20ft', 'lcv_container', 6, 7],
  ['LCV Container · 6 tyre · 7T · 22ft', 'lcv_container', 6, 7],
  ['LCV Container · 6 tyre · 7T · 24ft', 'lcv_container', 6, 7],
  ['LCV Container · 6 tyre · 7.5T · 20ft', 'lcv_container', 6, 7.5],
  ['LCV Container · 6 tyre · 7.5T · 22ft', 'lcv_container', 6, 7.5],
  ['LCV Container · 6 tyre · 7.5T · 24ft', 'lcv_container', 6, 7.5],
  ['Container · 6 tyre · 8T · 20ft', 'container', 6, 8],
  ['Container · 6 tyre · 9T · 22ft', 'container', 6, 9],
  ['Container · 6 tyre · 9T · 24ft', 'container', 6, 9],
  ['Container · 6 tyre · 9T · 34ft', 'container', 6, 9],
  ['Container · 6 tyre · 10T · 20ft', 'container', 6, 10],
  ['Container · 6 tyre · 10T · 22ft', 'container', 6, 10],
  ['Container · 6 tyre · 10T · 24ft', 'container', 6, 10],
  ['Container · 6 tyre · 12T · 20ft', 'container', 6, 12],
  ['Container · 6 tyre · 12T · 22ft', 'container', 6, 12],
  ['Container · 6 tyre · 12T · 24ft', 'container', 6, 12],
  ['Container · SXL · 7T · 32ft', 'container', 6, 7],
  ['Container · SXL · 7.5T · 32ft', 'container', 6, 7.5],
  ['Container · SXL · 8.5T · 32ft', 'container', 6, 8.5],
  ['Container · SXL · 9T · 32ft', 'container', 6, 9],
  ['Container · SXL 9.5 HC · 9.5T · 32ft', 'container', 6, 9.5],
  ['Container · SXL 10 HC · 9.5T · 32ft', 'container', 6, 9.5],
  ['Container · MXL · 14.5T · 32ft', 'container', 10, 14.5],
  ['Container · MXL · 15T · 32ft', 'container', 10, 15],
  ['Container · MXL · 18T · 32ft', 'container', 10, 18],
  ['Container · MXL · 24T · 32ft', 'container', 10, 24],
  ['Container · TXL · 19T · 32ft', 'container', 14, 19],
  ['Container · TXL · 20T · 32ft', 'container', 14, 20],
  ['Container · TXL · 24T · 32ft', 'container', 14, 24],
  ['Container · TXL · 25T · 32ft', 'container', 14, 25],
  ['Container · TXL · 30T · 32ft', 'container', 14, 30],
];

const ACTIVE_BODY_TYPES = ['open_body', 'container', 'lcv_open_body', 'lcv_container'];

/**
 * Replaces the truck-type list with the client's new one (body → tyres/axle → tonnes → feet):
 * - global catalog: deletes every entry not on the new list (tanker, tipper, bulker, trailers,
 *   mini pickup, the legacy name-only entries) and inserts the new ones;
 * - each org's truck types: deletes every row not on the new list and clears truck_type_id on the
 *   vehicles that used one so the org re-picks. A row a past load / load posting still points at
 *   is soft-deleted instead, so that history keeps its truck type;
 * - Loadsmart partner truck types: drops claims for body types no longer offered.
 * The query builder maps these tables to their entities, so set()/values() take property names.
 */
export class ReplaceTruckTypeCatalog1795480000000 implements MigrationInterface {
  name = 'ReplaceTruckTypeCatalog1795480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const names = NEW_CATALOG.map(([name]) => name);
    const now = new Date();

    // Global catalog — nothing references it, so old entries (and any soft-deleted leftovers) are
    // removed outright; then whichever new ones are missing are added.
    await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('masters.truck_type_catalog')
      .where('name NOT IN (:...names)', { names })
      .orWhere('deleted_at IS NOT NULL')
      .execute();

    const existing: { name: string }[] = await queryRunner.manager
      .createQueryBuilder()
      .select('catalog.name', 'name')
      .from('masters.truck_type_catalog', 'catalog')
      .getRawMany();
    const existingNames = new Set(existing.map((row) => row.name));
    const missing = NEW_CATALOG.filter(([name]) => !existingNames.has(name));
    if (missing.length > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into('masters.truck_type_catalog')
        .values(
          missing.map(([name, bodyType, wheels, tons]) => ({
            name,
            bodyType,
            wheelConfiguration: wheels,
            capacityTons: String(tons),
          })),
        )
        .execute();
    }

    // Org truck types — every row not on the new list (active or already soft-deleted) goes.
    const retired: { id: string }[] = await queryRunner.manager
      .createQueryBuilder()
      .select('truck_type.id', 'id')
      .from('masters.truck_types', 'truck_type')
      .where('truck_type.name NOT IN (:...names)', { names })
      .getRawMany();
    const retiredIds = retired.map((row) => row.id);

    // Past loads / load postings keep their truck type for history (loads has a RESTRICT FK), so
    // those rows are only soft-deleted; every other retired row is deleted outright.
    const keptIds = new Set<string>();
    if (retiredIds.length > 0) {
      const loadRefs: { id: string }[] = await queryRunner.manager
        .createQueryBuilder()
        .select('DISTINCT load.truck_type_id', 'id')
        .from('loads.loads', 'load')
        .where('load.truck_type_id IS NOT NULL')
        .getRawMany();
      const postingRefs: { id: string }[] = await queryRunner.manager
        .createQueryBuilder()
        .select(
          'DISTINCT unnest(array_append(posting.accepted_truck_type_ids, posting.truck_type_id))',
          'id',
        )
        .from('loads.load_postings', 'posting')
        .getRawMany();
      for (const row of [...loadRefs, ...postingRefs]) if (row.id) keptIds.add(row.id);
    }

    for (let start = 0; start < retiredIds.length; start += 1000) {
      const ids = retiredIds.slice(start, start + 1000);
      await queryRunner.manager
        .createQueryBuilder()
        .update('masters.vehicles')
        .set({ truckTypeId: null })
        .where('truck_type_id IN (:...ids)', { ids })
        .execute();

      const keep = ids.filter((id) => keptIds.has(id));
      const remove = ids.filter((id) => !keptIds.has(id));
      if (keep.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .update('masters.truck_types')
          .set({ deletedAt: now })
          .where('id IN (:...keep)', { keep })
          .andWhere('deleted_at IS NULL')
          .execute();
      }
      if (remove.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from('masters.truck_types')
          .where('id IN (:...remove)', { remove })
          .execute();
      }
    }

    // Loadsmart partners — drop claimed body types the list no longer offers.
    await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('loads.ls_partner_truck_types')
      .where('body_type NOT IN (:...bodyTypes)', { bodyTypes: ACTIVE_BODY_TYPES })
      .execute();
  }

  public async down(): Promise<void> {
    // Data-only and not reversible: the retired rows stay soft-deleted, and which vehicle used which
    // old truck type (cleared above) isn't recorded anywhere to restore from.
  }
}
