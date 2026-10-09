import { MigrationInterface, QueryRunner } from 'typeorm';

// "Add a driver" form: Engagement (how the driver is employed — kept separate from salary_type,
// which is how they're paid) and Bhatta per trip day (daily allowance, same numeric type as
// salary_amount). Both nullable with no backfill — existing drivers stay empty until edited.
export class AddDriverEngagementAndBhatta1790700000000 implements MigrationInterface {
  name = 'AddDriverEngagementAndBhatta1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_engagement_type_enum" AS ENUM('on_roll', 'per_trip', 'vendor')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "engagement_type" "masters"."drivers_engagement_type_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "bhatta_per_day" numeric(12,2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "bhatta_per_day"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "engagement_type"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_engagement_type_enum"`);
  }
}
