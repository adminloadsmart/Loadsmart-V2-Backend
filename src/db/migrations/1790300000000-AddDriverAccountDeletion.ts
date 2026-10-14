import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver self-service account deletion is a soft delete: masters.drivers.deleted_at is set and
// purge_after marks when the retained personal data (kept 90 days for trip/settlement history)
// becomes eligible for scrubbing.
export class AddDriverAccountDeletion1790300000000 implements MigrationInterface {
  name = 'AddDriverAccountDeletion1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "purge_after" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "drivers_purge_after_idx" ON "masters"."drivers" ("purge_after") WHERE "purge_after" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."drivers_purge_after_idx"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "purge_after"`);
  }
}
