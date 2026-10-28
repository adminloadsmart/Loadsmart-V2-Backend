import { MigrationInterface, QueryRunner } from 'typeorm';

// A load's own loading point and loading contact — set from the load page's "Change loading
// point" / "Change contact", for this load only. Null means the requisition's or posting's
// loading point (and that point's contact) applies; see modules/loads/utils/load-origin.ts.
export class LoadLoadingPointOverride1793400000000 implements MigrationInterface {
  name = 'LoadLoadingPointOverride1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        ADD "loading_point_id" uuid,
        ADD "loading_contact_name" character varying(150),
        ADD "loading_contact_phone" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_loads_loading_point"
        FOREIGN KEY ("loading_point_id") REFERENCES "masters"."loading_points"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    for (const action of ['LOADING_CONTACT_CHANGED', 'LOADING_POINT_CHANGED']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  // The two activity values stay on load_activities_action_enum — Postgres can't drop an enum value.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_loads_loading_point"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        DROP COLUMN "loading_contact_phone",
        DROP COLUMN "loading_contact_name",
        DROP COLUMN "loading_point_id"`,
    );
  }
}
