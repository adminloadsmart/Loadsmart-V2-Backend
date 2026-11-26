import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Road distance from pickup to drop, in km — shown under the route on Placement's work queue.
 * Looked up once on Google Routes from the posting's pickup/drop points and kept; null until then
 * (or when the points are missing or Google finds no route).
 */
export class PostingDistanceKm1795560000000 implements MigrationInterface {
  name = 'PostingDistanceKm1795560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD COLUMN IF NOT EXISTS "distance_km" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" DROP COLUMN IF EXISTS "distance_km"`,
    );
  }
}
