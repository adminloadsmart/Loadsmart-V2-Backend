import { MigrationInterface, QueryRunner } from 'typeorm';

/** The new default arrival geofence, inlined so this migration means the same thing later. */
const RADIUS_M = 2000;
const PREVIOUS_DEFAULT_M = 300;

/**
 * Every arrival geofence becomes 2 km: the column default on loading points and customer delivery
 * points, every existing point, and every circle geofence (the loading-point / unloading-point
 * fences synced from those points, and any drawn in Tracking → Geofences). Polygons are left alone.
 *
 * down() only restores the column defaults: the radii each point had before can't be recovered.
 */
export class GeofenceRadius2Km1795490000000 implements MigrationInterface {
  name = 'GeofenceRadius2Km1795490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.setDefault(queryRunner, RADIUS_M);

    for (const table of ['masters.loading_points', 'customers.customer_delivery_points']) {
      await queryRunner.manager
        .createQueryBuilder()
        .update(table)
        .set({ geofenceRadiusM: RADIUS_M })
        .execute();
    }

    await queryRunner.manager
      .createQueryBuilder()
      .update('tracking.geofences')
      .set({ radiusM: RADIUS_M })
      .where('shape = :shape', { shape: 'circle' })
      .execute();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setDefault(queryRunner, PREVIOUS_DEFAULT_M);
  }

  private async setDefault(queryRunner: QueryRunner, radiusM: number): Promise<void> {
    // DDL: a column default can only be changed with ALTER TABLE.
    await queryRunner.query(
      `ALTER TABLE "masters"."loading_points" ALTER COLUMN "geofence_radius_m" SET DEFAULT ${radiusM}`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ALTER COLUMN "geofence_radius_m" SET DEFAULT ${radiusM}`,
    );
  }
}
