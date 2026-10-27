import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver detail screen: the "Fit to drive again from" date on an On leave / Medically unfit status
// (the daily driver-availability-return job sets the driver back to Available on it), and who
// last wrote the fleet's note and when ("Note · team only · Mohit, 1 Aug 2020"). Existing notes
// keep a null author — it was never recorded.
export class DriverDetailFitDateAndNoteAuthor1792800000000 implements MigrationInterface {
  name = 'DriverDetailFitDateAndNoteAuthor1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD "available_from" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations"
        ADD "note_updated_by" uuid,
        ADD "note_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations"
        DROP COLUMN "note_updated_at",
        DROP COLUMN "note_updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP COLUMN "available_from"`,
    );
  }
}
